import { basename } from "node:path"

import type { ExternalBlock, MediaSidecar } from "../common/schema"
import type { PexelsJsonLd } from "../crawl/extractJsonLd"
import type { ProviderItem } from "../providers/types"

const MAX_CORE_TAGS = 40

function mediaTypeLabel(mediaType: ProviderItem["media_type"]): string {
  if (mediaType === "image") return "Photo"
  if (mediaType === "video") return "Video"
  return "Audio"
}

function providerLabel(provider: string): string {
  if (provider.length === 0) return provider
  return provider.charAt(0).toUpperCase() + provider.slice(1)
}

function buildCoreTags(item: ProviderItem, jsonLd: PexelsJsonLd | null): string[] {
  const fromJsonLd =
    jsonLd?.keywords
      ?.split(", ")
      .map((tag) => tag.trim())
      .filter(Boolean) ?? []
  const seen = new Set<string>()
  const out: string[] = []
  for (const tag of [...item.api_tags, ...fromJsonLd]) {
    const lower = tag.toLowerCase()
    if (lower.length === 0 || seen.has(lower)) continue
    seen.add(lower)
    out.push(lower)
    if (out.length >= MAX_CORE_TAGS) break
  }
  return out
}

function buildTechnical(item: ProviderItem): Record<string, string | number | boolean | null> {
  const technical: Record<string, string | number | boolean | null> = {}
  if (item.width !== undefined) technical["width"] = item.width
  if (item.height !== undefined) technical["height"] = item.height
  if (item.duration_seconds !== undefined) technical["duration_seconds"] = item.duration_seconds
  return technical
}

function buildExif(jsonLd: PexelsJsonLd | null): Record<string, string | number> | undefined {
  const exifData = jsonLd?.exifData
  if (exifData === undefined || exifData.length === 0) return undefined
  const exif: Record<string, string | number> = {}
  for (const { name, value } of exifData) {
    exif[name] = value
  }
  return exif
}

export function buildExternalSidecar(
  item: ProviderItem,
  jsonLd: PexelsJsonLd | null,
  localPath: string,
  sha256: string,
  rawPath: string,
): MediaSidecar {
  const now = new Date().toISOString()
  const creditsText = `${mediaTypeLabel(item.media_type)} by ${item.creator.name} on ${providerLabel(item.provider)}: ${item.source_url}`

  const external: ExternalBlock = {
    provider: item.provider,
    source_id: item.source_id,
    source_url: item.source_url,
    download_url: item.download_url,
    creator: item.creator,
    license: item.license,
    license_url: item.license_url,
    credits: {
      required: false,
      text: creditsText,
    },
    raw_metadata_path: rawPath,
  }

  const exif = buildExif(jsonLd)
  if (exif !== undefined) external.exif = exif
  const location = jsonLd?.contentLocation?.name
  if (location !== undefined) external.location = location

  return {
    schema_version: "1.1",
    asset_id: `sha256:${sha256}`,
    source_file: basename(localPath),
    media_type: item.media_type,
    created_at: now,
    updated_at: now,
    technical: buildTechnical(item),
    summary: {
      title: item.title || (jsonLd?.description?.slice(0, 100) ?? ""),
      short_caption: jsonLd?.description ?? item.description,
      detailed_caption: "",
      best_use: [],
      not_recommended_for: [],
    },
    tags: {
      core: buildCoreTags(item, jsonLd),
      visual: [],
      audio: [],
      mood: [],
      style: [],
      editing: [],
      project: [],
    },
    quality: {
      overall_score: 0,
      reuse_score: 0,
    },
    rights: {
      owner: "external",
      source: item.provider,
      license: item.license,
      notes: creditsText,
    },
    api_usage: {
      provider: "none",
      model: "none",
      media_uploaded_to_api: false,
    },
    external,
  }
}
