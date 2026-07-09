import { pexelsProvider } from "../providers/pexels"
import type { MediaTypeFilter, Provider } from "../providers/types"
import { wikimediaProvider } from "../providers/wikimedia"

export type ResolveResult =
  | { readonly ok: true; readonly providers: readonly Provider[] }
  | { readonly ok: false }

export function parseMediaType(value: string | undefined): MediaTypeFilter {
  if (value === "image" || value === "video" || value === "audio") return value
  return "all"
}

export function parseLimit(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? String(fallback), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * Resolve providers from the --provider flag.
 * Returns { ok: false } after emitting an error when a required key is missing.
 */
export function resolveProviders(provider: string | undefined): ResolveResult {
  const hasPexelsKey = typeof process.env["PEXELS_API_KEY"] === "string"

  if (provider === "pexels") {
    if (!hasPexelsKey) {
      process.exitCode = 1
      console.error("PEXELS_API_KEY required")
      return { ok: false }
    }
    return { ok: true, providers: [pexelsProvider] }
  }

  if (provider === "wikimedia") {
    return { ok: true, providers: [wikimediaProvider] }
  }

  // "all" (default)
  if (hasPexelsKey) {
    return { ok: true, providers: [pexelsProvider, wikimediaProvider] }
  }
  console.warn("PEXELS_API_KEY not set, skipping Pexels")
  return { ok: true, providers: [wikimediaProvider] }
}
