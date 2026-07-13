import { pexelsProvider } from "../providers/pexels"
import { pixabayProvider } from "../providers/pixabay"
import type { MediaTypeFilter, Provider } from "../providers/types"
import { unsplashProvider } from "../providers/unsplash"
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

function hasNonemptyEnv(name: string): boolean {
  return (process.env[name]?.trim().length ?? 0) > 0
}

/**
 * Resolve providers from the --provider flag.
 * Returns { ok: false } after emitting an error when a required key is missing.
 */
export function resolveProviders(provider: string | undefined): ResolveResult {
  const hasPexelsKey = hasNonemptyEnv("PEXELS_API_KEY")
  const hasPixabayKey = hasNonemptyEnv("PIXABAY_API_KEY")
  const hasUnsplashKey = hasNonemptyEnv("UNSPLASH_ACCESS_KEY")

  if (provider === "pexels") {
    if (!hasPexelsKey) {
      process.exitCode = 1
      console.error("PEXELS_API_KEY required")
      return { ok: false }
    }
    return { ok: true, providers: [pexelsProvider] }
  }

  if (provider === "pixabay") {
    if (!hasPixabayKey) {
      process.exitCode = 1
      console.error("PIXABAY_API_KEY required")
      return { ok: false }
    }
    return { ok: true, providers: [pixabayProvider] }
  }

  if (provider === "unsplash") {
    if (!hasUnsplashKey) {
      process.exitCode = 1
      console.error("UNSPLASH_ACCESS_KEY required")
      return { ok: false }
    }
    return { ok: true, providers: [unsplashProvider] }
  }

  if (provider === "wikimedia") {
    return { ok: true, providers: [wikimediaProvider] }
  }

  if (provider !== undefined && provider !== "all") {
    process.exitCode = 1
    console.error(`Unknown provider: ${provider}`)
    return { ok: false }
  }

  // "all" (default). Keep the priority deterministic.
  const providers: Provider[] = []
  if (hasPexelsKey) {
    providers.push(pexelsProvider)
  } else {
    console.warn("PEXELS_API_KEY not set, skipping Pexels")
  }
  if (hasPixabayKey) {
    providers.push(pixabayProvider)
  } else {
    console.warn("PIXABAY_API_KEY not set, skipping Pixabay")
  }
  if (hasUnsplashKey) {
    providers.push(unsplashProvider)
  } else {
    console.warn("UNSPLASH_ACCESS_KEY not set, skipping Unsplash")
  }
  providers.push(wikimediaProvider)
  return { ok: true, providers }
}
