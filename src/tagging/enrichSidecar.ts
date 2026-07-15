import { readFile } from "node:fs/promises"
import { extname } from "node:path"

import { z } from "zod"

import { logger } from "../common/logger"
import { BgmMetaSchema, ImageMetaSchema, type MediaSidecar } from "../common/schema"
import { analyzeAudio } from "../llm/audioClient"
import {
  type ApiClientConfig,
  analyzeImage,
  type ImageInput,
  requestStructuredChatCompletion,
} from "../llm/vlmClient"
import { buildBgmPrompt } from "./buildBgmPrompt"
import { buildImagePrompt } from "./buildImagePrompt"
import {
  buildVideoPrompt,
  type VideoTaggingResponse,
  VideoTaggingResponseSchema,
} from "./buildVideoPrompt"
import { detectTempoKey as defaultDetectTempoKey, type TempoKeyResult } from "./detectTempoKey"
import { extractFirstAudioClip } from "./extractAudioClip"
import { type SampledFrame, sampleFrames } from "./sampleFrames"

export type EnrichOptions = {
  readonly apiKey?: string
  readonly apiBaseUrl?: string
  readonly apiModel?: string
  // ponytail: injectable API/ffmpeg calls for tests; defaults to real implementations.
  // Upgrade path: drop when a shared HTTP-mock harness lands.
  readonly analyze?: typeof analyzeImage
  readonly analyzeAudio?: typeof analyzeAudio
  readonly analyzeVideo?: typeof requestStructuredChatCompletion
  readonly sampleVideoFrames?: typeof sampleFrames
  readonly readFrame?: (path: string) => Promise<string>
  readonly extractAudioClip?: typeof extractFirstAudioClip
  readonly detectTempoKey?: (path: string) => Promise<TempoKeyResult | null>
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1"
const DEFAULT_MODEL = "gpt-4o-mini"

const StringListSchema = z.array(z.string())

// Same response contract as media-tagger's ImageTagResponseSchema.
const ImageResultSchema = z.object({
  title: z.string(),
  short_caption: z.string(),
  detailed_caption: z.string(),
  best_use: StringListSchema,
  not_recommended_for: StringListSchema,
  tags: z.object({
    core: StringListSchema,
    visual: StringListSchema,
    audio: StringListSchema,
    mood: StringListSchema,
    style: StringListSchema,
    editing: StringListSchema,
    project: StringListSchema,
  }),
  quality: z.object({ overall_score: z.number(), reuse_score: z.number() }),
  image: ImageMetaSchema,
})

const BgmResultSchema = BgmMetaSchema.omit({ tempo: true, key: true }).extend({
  tags: z.array(z.string()),
  quality: z.object({ overall_score: z.number(), reuse_score: z.number() }),
})

type ImageResult = z.infer<typeof ImageResultSchema>
type BgmResult = z.infer<typeof BgmResultSchema>

function env(key: string): string | undefined {
  const v = process.env[key]
  return v !== undefined && v.trim().length > 0 ? v : undefined
}

export function resolveBase(options: EnrichOptions): ApiClientConfig {
  const apiKey = options.apiKey ?? env("MEDIA_INGEST_API_KEY")
  return {
    api: true,
    base_url: options.apiBaseUrl ?? env("MEDIA_INGEST_BASE_URL") ?? DEFAULT_BASE_URL,
    model: options.apiModel ?? env("MEDIA_INGEST_MODEL") ?? DEFAULT_MODEL,
    ...(apiKey !== undefined ? { api_key: apiKey } : {}),
  }
}

function resolveVlm(base: ApiClientConfig): ApiClientConfig {
  const vlmUrl = env("MEDIA_INGEST_VLM_BASE_URL")
  const vlmModel = env("MEDIA_INGEST_VLM_MODEL")
  const vlmKey = env("MEDIA_INGEST_VLM_API_KEY")
  if (vlmUrl === undefined && vlmModel === undefined && vlmKey === undefined) return base
  return {
    ...base,
    base_url: vlmUrl ?? base.base_url,
    model: vlmModel ?? base.model,
    ...(vlmKey !== undefined ? { api_key: vlmKey } : {}),
  }
}

function resolveAudio(vlm: ApiClientConfig): ApiClientConfig {
  const audioUrl = env("MEDIA_INGEST_AUDIO_BASE_URL")
  const audioModel = env("MEDIA_INGEST_AUDIO_MODEL")
  const audioKey = env("MEDIA_INGEST_AUDIO_API_KEY")
  if (audioUrl === undefined && audioModel === undefined && audioKey === undefined) return vlm
  return {
    ...vlm,
    base_url: audioUrl ?? vlm.base_url,
    model: audioModel ?? vlm.model,
    ...(audioKey !== undefined ? { api_key: audioKey } : {}),
  }
}

function mimeFor(localPath: string): string {
  const ext = extname(localPath).toLowerCase().replace(".", "")
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg"
  if (ext === "png") return "image/png"
  if (ext === "webp") return "image/webp"
  if (ext === "gif") return "image/gif"
  return "image/jpeg"
}

async function imageInput(localPath: string): Promise<ImageInput> {
  const bytes = await readFile(localPath)
  const dataUrl = `data:${mimeFor(localPath)};base64,${bytes.toString("base64")}`
  return { kind: "data_url", data_url: dataUrl }
}

async function defaultReadFrame(path: string): Promise<string> {
  const bytes = await readFile(path)
  return `data:image/jpeg;base64,${bytes.toString("base64")}`
}

function uniqueAppend(existing: readonly string[], additions: readonly string[]): string[] {
  const seen = new Set(existing)
  const merged = [...existing]
  for (const tag of additions) {
    if (!seen.has(tag)) {
      seen.add(tag)
      merged.push(tag)
    }
  }
  return merged
}

function technicalNumber(sidecar: MediaSidecar, key: string): number | null {
  const value = sidecar.technical[key]
  return typeof value === "number" ? value : null
}

function promptInput(sidecar: MediaSidecar): {
  width: number | null
  height: number | null
  aspect_ratio: string | null
} {
  const aspect = sidecar.technical["aspect_ratio"]
  return {
    width: technicalNumber(sidecar, "width"),
    height: technicalNumber(sidecar, "height"),
    aspect_ratio: typeof aspect === "string" ? aspect : null,
  }
}

function keepOr(existing: string, incoming: string): string {
  return existing.length === 0 ? incoming : existing
}

function mergeImageResult(
  sidecar: MediaSidecar,
  config: ApiClientConfig,
  result: ImageResult,
): MediaSidecar {
  const { title, short_caption, detailed_caption, best_use, not_recommended_for } = result
  return {
    ...sidecar,
    summary: mergeSummary(sidecar.summary, {
      title,
      short_caption,
      detailed_caption,
      best_use,
      not_recommended_for,
    }),
    tags: mergeTags(sidecar.tags, result.tags),
    quality: result.quality,
    image: result.image,
    api_usage: usage(config),
  }
}

function mergeSummary(
  existing: MediaSidecar["summary"],
  incoming: MediaSidecar["summary"],
): MediaSidecar["summary"] {
  return {
    title: keepOr(existing.title, incoming.title),
    short_caption: keepOr(existing.short_caption, incoming.short_caption),
    detailed_caption: keepOr(existing.detailed_caption, incoming.detailed_caption),
    best_use: uniqueAppend(existing.best_use, incoming.best_use),
    not_recommended_for: uniqueAppend(existing.not_recommended_for, incoming.not_recommended_for),
  }
}

function mergeTags(
  existing: MediaSidecar["tags"],
  incoming: MediaSidecar["tags"],
): MediaSidecar["tags"] {
  return {
    core: uniqueAppend(existing.core, incoming.core),
    visual: uniqueAppend(existing.visual, incoming.visual),
    audio: uniqueAppend(existing.audio, incoming.audio),
    mood: uniqueAppend(existing.mood, incoming.mood),
    style: uniqueAppend(existing.style, incoming.style),
    editing: uniqueAppend(existing.editing, incoming.editing),
    project: uniqueAppend(existing.project, incoming.project),
  }
}

function usage(config: ApiClientConfig): MediaSidecar["api_usage"] {
  return {
    provider: config.base_url,
    model: config.model,
    media_uploaded_to_api: true,
  }
}

function mergeVideoResult(
  sidecar: MediaSidecar,
  config: ApiClientConfig,
  frames: readonly SampledFrame[],
  result: VideoTaggingResponse,
): MediaSidecar {
  const first = frames[0]
  const second = frames[1]
  const interval = first !== undefined && second !== undefined ? second.time - first.time : 0
  return {
    ...sidecar,
    summary: mergeSummary(sidecar.summary, result.summary),
    tags: mergeTags(sidecar.tags, result.overall_tags),
    quality: result.quality,
    video: {
      sampling: {
        interval_seconds: interval,
        frames: frames.map((frame) => ({ time_seconds: frame.time, path: frame.path })),
      },
      segments: result.segments,
    },
    api_usage: usage(config),
  }
}

function mergeBgmResult(
  sidecar: MediaSidecar,
  config: ApiClientConfig,
  result: BgmResult,
): MediaSidecar {
  const { tags, quality, ...bgm } = result
  return {
    ...sidecar,
    tags: {
      ...sidecar.tags,
      audio: uniqueAppend(sidecar.tags.audio, [...bgm.genre, ...tags]),
      mood: uniqueAppend(sidecar.tags.mood, bgm.mood),
      editing: uniqueAppend(sidecar.tags.editing, bgm.editing_use),
    },
    quality,
    bgm,
    api_usage: usage(config),
  }
}

function withFailedUsage(sidecar: MediaSidecar, config: ApiClientConfig): MediaSidecar {
  return {
    ...sidecar,
    api_usage: {
      provider: config.base_url,
      model: config.model,
      media_uploaded_to_api: false,
    },
  }
}

/**
 * Optionally enrich a sidecar with AI analysis.
 * NEVER modifies: source, rights, asset_id.
 * Fills empty summary/tags fields and appends unique tags.
 * API failure = non-fatal: logs error, returns sidecar as-is with api_usage populated.
 */
export async function enrichSidecar(
  sidecar: MediaSidecar,
  localPath: string,
  options: EnrichOptions,
): Promise<MediaSidecar> {
  const base = resolveBase(options)
  const vlmConfig = resolveVlm(base)
  const audioConfig = resolveAudio(vlmConfig)

  if (sidecar.media_type === "audio") {
    return enrichAudio(sidecar, localPath, options, audioConfig)
  }

  if (sidecar.media_type === "video") {
    return enrichVideo(sidecar, localPath, options, vlmConfig)
  }

  return enrichImage(sidecar, localPath, options, vlmConfig)
}

// no-excuse-ok: API failure must be non-fatal in all enrich paths
async function enrichImage(
  sidecar: MediaSidecar,
  localPath: string,
  options: EnrichOptions,
  vlmConfig: ApiClientConfig,
): Promise<MediaSidecar> {
  const analyze = options.analyze ?? analyzeImage
  try {
    const result = await analyze({
      ...vlmConfig,
      image: await imageInput(localPath),
      prompt: buildImagePrompt(promptInput(sidecar)),
      schema: ImageResultSchema,
    })
    if (result === null) {
      return withFailedUsage(sidecar, vlmConfig)
    }
    return mergeImageResult(sidecar, vlmConfig, result)
  } catch (error) {
    logger.error(error instanceof Error ? error.message : "enrichSidecar failed")
    return withFailedUsage(sidecar, vlmConfig)
  }
}

async function enrichVideo(
  sidecar: MediaSidecar,
  localPath: string,
  options: EnrichOptions,
  vlmConfig: ApiClientConfig,
): Promise<MediaSidecar> {
  const sample = options.sampleVideoFrames ?? sampleFrames
  const readFrame = options.readFrame ?? defaultReadFrame
  const request = options.analyzeVideo ?? requestStructuredChatCompletion
  try {
    const duration = technicalNumber(sidecar, "duration")
    const frames = await sample(localPath, duration !== null ? { durationSeconds: duration } : {})
    if (frames.length === 0) {
      logger.warn("video frame sampling produced no frames", { path: localPath })
      return withFailedUsage(sidecar, vlmConfig)
    }

    const frameParts = await Promise.all(
      frames.map(async (frame) => ({
        type: "image_url" as const,
        image_url: { url: await readFrame(frame.path) },
      })),
    )
    const result = await request({ ...vlmConfig, schema: VideoTaggingResponseSchema }, [
      { type: "text", text: buildVideoPrompt({ frames }) },
      ...frameParts,
    ])
    if (result === null) {
      return withFailedUsage(sidecar, vlmConfig)
    }
    return mergeVideoResult(sidecar, vlmConfig, frames, result)
  } catch (error) {
    logger.error(error instanceof Error ? error.message : "video enrichment failed")
    return withFailedUsage(sidecar, vlmConfig)
  }
}

async function enrichAudio(
  sidecar: MediaSidecar,
  localPath: string,
  options: EnrichOptions,
  audioConfig: ApiClientConfig,
): Promise<MediaSidecar> {
  const extractClip = options.extractAudioClip ?? extractFirstAudioClip
  const analyzeAudioImpl = options.analyzeAudio ?? analyzeAudio
  const enriched = await withLocalTempoKey(sidecar, localPath, options)
  try {
    const clip = await extractClip(localPath)
    if (clip === null) {
      return withFailedUsage(enriched, audioConfig)
    }
    const result = await analyzeAudioImpl({
      ...audioConfig,
      audio: clip,
      prompt: buildBgmPrompt(bgmPromptInput(enriched)),
      schema: BgmResultSchema,
    })
    if (result === null) {
      return withFailedUsage(enriched, audioConfig)
    }
    return mergeBgmResult(enriched, audioConfig, result)
  } catch (error) {
    logger.error(error instanceof Error ? error.message : "audio enrichment failed")
    return withFailedUsage(enriched, audioConfig)
  }
}

async function withLocalTempoKey(
  sidecar: MediaSidecar,
  localPath: string,
  options: EnrichOptions,
): Promise<MediaSidecar> {
  const detect = options.detectTempoKey ?? defaultDetectTempoKey
  const tempoKey = await detect(localPath)
  if (tempoKey === null) {
    return sidecar
  }
  return {
    ...sidecar,
    technical: {
      ...sidecar.technical,
      tempo: { bpm: tempoKey.tempo.bpm, confidence: tempoKey.tempo.confidence },
      key: { value: tempoKey.key.value, confidence: tempoKey.key.confidence },
    },
  }
}

function bgmPromptInput(sidecar: MediaSidecar): {
  duration: number | null
  codec: string | null
  sample_rate: number | null
  channels: number | null
  bitrate: number | null
} {
  const str = (key: string): string | null => {
    const value = sidecar.technical[key]
    return typeof value === "string" ? value : null
  }
  return {
    duration: technicalNumber(sidecar, "duration"),
    codec: str("codec"),
    sample_rate: technicalNumber(sidecar, "sample_rate"),
    channels: technicalNumber(sidecar, "channels"),
    bitrate: technicalNumber(sidecar, "bitrate"),
  }
}
