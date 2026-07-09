import { readFile } from "node:fs/promises"
import { extname } from "node:path"

import { z } from "zod"

import { logger } from "../common/logger"
import type { MediaSidecar } from "../common/schema"
import { analyzeAudio } from "../llm/audioClient"
import { type ApiClientConfig, analyzeImage, type ImageInput } from "../llm/vlmClient"

export type EnrichOptions = {
  readonly apiKey?: string
  readonly apiBaseUrl?: string
  readonly apiModel?: string
  // ponytail: injectable VLM call for tests; defaults to real analyzeImage.
  // Upgrade path: drop when a shared HTTP-mock harness lands.
  readonly analyze?: typeof analyzeImage
  readonly analyzeAudio?: typeof analyzeAudio
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1"
const DEFAULT_MODEL = "gpt-4o-mini"

const IMAGE_PROMPT =
  "Analyze this image for a stock-media library. Respond with JSON: " +
  '{"title": short descriptive title, "short_caption": one-sentence caption, ' +
  '"tags": array of concise keyword tags}.'

const ImageResultSchema = z.object({
  title: z.string(),
  short_caption: z.string(),
  tags: z.array(z.string()),
})

const AudioResultSchema = z.object({}).passthrough()

type ImageResult = z.infer<typeof ImageResultSchema>

function resolveConfig(options: EnrichOptions): ApiClientConfig {
  const { MEDIA_INGEST_API_KEY, MEDIA_INGEST_BASE_URL, MEDIA_INGEST_MODEL } = process.env
  const apiKey = options.apiKey ?? MEDIA_INGEST_API_KEY
  return {
    api: true,
    base_url: options.apiBaseUrl ?? MEDIA_INGEST_BASE_URL ?? DEFAULT_BASE_URL,
    model: options.apiModel ?? MEDIA_INGEST_MODEL ?? DEFAULT_MODEL,
    ...(apiKey !== undefined ? { api_key: apiKey } : {}),
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

function audioMimeFor(localPath: string): string {
  const ext = extname(localPath).toLowerCase().replace(".", "")
  if (ext === "mp3" || ext === "mpeg") return "audio/mpeg"
  return "audio/mpeg"
}

async function imageInput(localPath: string): Promise<ImageInput> {
  const bytes = await readFile(localPath)
  const dataUrl = `data:${mimeFor(localPath)};base64,${bytes.toString("base64")}`
  return { kind: "data_url", data_url: dataUrl }
}

async function audioInput(
  localPath: string,
): Promise<{ readonly kind: "data_url"; readonly data_url: string }> {
  const bytes = await readFile(localPath)
  const dataUrl = `data:${audioMimeFor(localPath)};base64,${bytes.toString("base64")}`
  return { kind: "data_url", data_url: dataUrl }
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

function mergeImageResult(
  sidecar: MediaSidecar,
  config: ApiClientConfig,
  result: ImageResult,
): MediaSidecar {
  return {
    ...sidecar,
    summary: {
      ...sidecar.summary,
      title: sidecar.summary.title.length === 0 ? result.title : sidecar.summary.title,
      short_caption:
        sidecar.summary.short_caption.length === 0
          ? result.short_caption
          : sidecar.summary.short_caption,
    },
    tags: {
      ...sidecar.tags,
      core: uniqueAppend(sidecar.tags.core, result.tags),
    },
    api_usage: {
      provider: config.base_url,
      model: config.model,
      media_uploaded_to_api: true,
    },
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
  const config = resolveConfig(options)
  const analyze = options.analyze ?? analyzeImage
  const analyzeAudioImpl = options.analyzeAudio ?? analyzeAudio

  if (sidecar.media_type === "audio") {
    try {
      await analyzeAudioImpl({
        ...config,
        audio: await audioInput(localPath),
        prompt: "Extract concise audio metadata.",
        schema: AudioResultSchema,
      })
    } catch (error) {
      logger.error(error instanceof Error ? error.message : "audio enrichment failed")
    }
    return withFailedUsage(sidecar, config)
  }

  if (sidecar.media_type !== "image") {
    logger.warn("video/audio enrichment requires ffmpeg", { media_type: sidecar.media_type })
    return withFailedUsage(sidecar, config)
  }

  // no-excuse-ok: API failure must be non-fatal
  try {
    const result = await analyze({
      ...config,
      image: await imageInput(localPath),
      prompt: IMAGE_PROMPT,
      schema: ImageResultSchema,
    })
    if (result === null) {
      return withFailedUsage(sidecar, config)
    }
    return mergeImageResult(sidecar, config, result)
  } catch (error) {
    logger.error(error instanceof Error ? error.message : "enrichSidecar failed")
    return withFailedUsage(sidecar, config)
  }
}
