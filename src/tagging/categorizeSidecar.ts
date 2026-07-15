import { logger } from "../common/logger"
import type { MediaSidecar } from "../common/schema"
import { type ApiClientConfig, requestStructuredChatCompletion } from "../llm/vlmClient"
import {
  buildCategorizePrompt,
  type CategorizePromptInput,
  CategorizeResultSchema,
} from "./buildCategorizePrompt"
import { resolveBase } from "./enrichSidecar"

export type CategorizeOptions = {
  readonly apiKey?: string
  readonly apiBaseUrl?: string
  readonly apiModel?: string
  // true = VLM enrichment will run after us; skip best_use/not_recommended_for.
  readonly willEnrich?: boolean
  // ponytail: injectable LLM call for tests; defaults to the real client.
  // Upgrade path: drop when a shared HTTP-mock harness lands.
  readonly request?: typeof requestStructuredChatCompletion
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

function keepOr(existing: string, incoming: string): string {
  return existing.length === 0 ? incoming : existing
}

function categorizeUsage(config: ApiClientConfig): MediaSidecar["api_usage"] {
  // NOT usage() from enrichSidecar: text-only categorization uploads no media.
  return { provider: config.base_url, model: config.model, media_uploaded_to_api: false }
}

function technicalNumber(sidecar: MediaSidecar, key: string): number | null {
  const value = sidecar.technical[key]
  return typeof value === "number" ? value : null
}

/**
 * Text-only LLM pass that redistributes provider-supplied core tags into facet
 * buckets and optionally proposes summary fields. Sends NO media to the API.
 * NEVER modifies: source, rights, asset_id, tags.project.
 * API failure = non-fatal: logs, returns sidecar with api_usage populated.
 */
export async function categorizeSidecar(
  sidecar: MediaSidecar,
  options: CategorizeOptions,
): Promise<MediaSidecar> {
  if (
    sidecar.tags.core.length === 0 &&
    sidecar.summary.title.length > 0 &&
    sidecar.summary.short_caption.length > 0
  ) {
    return sidecar
  }

  const config = resolveBase(options)
  const originalCore = [...sidecar.tags.core]

  const aspect = sidecar.technical["aspect_ratio"]
  const promptInput: CategorizePromptInput = {
    media_type: sidecar.media_type,
    core_tags: sidecar.tags.core,
    title: sidecar.summary.title,
    short_caption: sidecar.summary.short_caption,
    provider: sidecar.source?.provider ?? null,
    technical: {
      width: technicalNumber(sidecar, "width"),
      height: technicalNumber(sidecar, "height"),
      duration: technicalNumber(sidecar, "duration"),
      aspect_ratio: typeof aspect === "string" ? aspect : null,
    },
    include_use_fields: options.willEnrich !== true,
  }

  try {
    const result = await (options.request ?? requestStructuredChatCompletion)(
      { ...config, schema: CategorizeResultSchema },
      [{ type: "text", text: buildCategorizePrompt(promptInput) }],
    )

    if (result === null) {
      return { ...sidecar, api_usage: categorizeUsage(config) }
    }

    // MOVE semantics: start from the LLM's core, then re-append any original tag
    // the LLM dropped from ALL buckets. Bounded: originalCore ≤ MAX_CORE_TAGS.
    const allLlmTags = new Set([
      ...result.tags.core,
      ...result.tags.visual,
      ...result.tags.audio,
      ...result.tags.mood,
      ...result.tags.style,
      ...result.tags.editing,
    ])
    const safetyNet = originalCore.filter((t) => !allLlmTags.has(t))
    const newCore = [...result.tags.core, ...safetyNet]

    const newTags: MediaSidecar["tags"] = {
      core: newCore,
      visual: uniqueAppend(sidecar.tags.visual, result.tags.visual),
      audio: uniqueAppend(sidecar.tags.audio, result.tags.audio),
      mood: uniqueAppend(sidecar.tags.mood, result.tags.mood),
      style: uniqueAppend(sidecar.tags.style, result.tags.style),
      editing: uniqueAppend(sidecar.tags.editing, result.tags.editing),
      project: sidecar.tags.project,
    }

    const newSummary: MediaSidecar["summary"] = {
      title: keepOr(sidecar.summary.title, result.title),
      short_caption: keepOr(sidecar.summary.short_caption, result.short_caption),
      detailed_caption: sidecar.summary.detailed_caption,
      best_use:
        options.willEnrich !== true
          ? uniqueAppend(sidecar.summary.best_use, result.best_use)
          : sidecar.summary.best_use,
      not_recommended_for:
        options.willEnrich !== true
          ? uniqueAppend(sidecar.summary.not_recommended_for, result.not_recommended_for)
          : sidecar.summary.not_recommended_for,
    }

    return {
      ...sidecar,
      tags: newTags,
      summary: newSummary,
      api_usage: categorizeUsage(config),
    }
  } catch (error) {
    logger.error(error instanceof Error ? error.message : "categorizeSidecar failed")
    return { ...sidecar, api_usage: categorizeUsage(config) }
  }
}
