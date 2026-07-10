import { basename } from "node:path"
import { parseIsoDuration } from "../common/parseIsoDuration"
import type { MediaSidecar, SourceBlock } from "../common/schema"
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

function buildTechnical(
  item: ProviderItem,
  jsonLd: PexelsJsonLd | null,
): Record<string, string | number | boolean | null> {
  const duration =
    jsonLd?.duration !== undefined ? parseIsoDuration(jsonLd.duration) : item.duration_seconds
  const technical: {
    width?: number
    height?: number
    duration_seconds?: number
  } = {}
  if (item.width !== undefined) technical.width = item.width
  if (item.height !== undefined) technical.height = item.height
  if (duration !== undefined) technical.duration_seconds = duration
  return technical
}

const PEXELS_EXIF_NAME_MAP: Record<string, string> = {
  Camera: "Model",
  Make: "Make",
  "Focal length": "FocalLength",
  Aperture: "FNumber",
  "Exposure time": "ExposureTime",
  ISO: "ISO",
  Photographed: "DateTimeOriginal",
}

const NUMERIC_EXIF_KEYS = new Set(["FocalLength", "FNumber", "ExposureTime", "ISO"])

function buildExif(jsonLd: PexelsJsonLd | null): Record<string, string | number> | undefined {
  const exifData = jsonLd?.exifData
  if (exifData === undefined || exifData.length === 0) return undefined
  const exif: Record<string, string | number> = {}
  for (const { name, value } of exifData) {
    const key = PEXELS_EXIF_NAME_MAP[name] ?? name
    const numeric = typeof value === "string" ? Number(value) : value
    exif[key] = NUMERIC_EXIF_KEYS.has(key) && Number.isFinite(numeric) ? numeric : value
  }
  return exif
}

export function buildExternalSidecar(
  item: ProviderItem,
  jsonLd: PexelsJsonLd | null,
  localPath: string,
  sha256: string,
): MediaSidecar {
  const now = new Date().toISOString()
  const creditsText = `${mediaTypeLabel(item.media_type)} by ${item.creator.name} on ${providerLabel(item.provider)}: ${item.source_url}`

  const source: SourceBlock = {
    origin: "external",
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
    raw: { api: item.raw, json_ld: jsonLd },
  }

  const exif = buildExif(jsonLd)
  if (exif !== undefined) source.exif = exif
  const location = jsonLd?.contentLocation?.name
  if (location !== undefined) source.location = location

  return {
    schema_version: "1.1",
    asset_id: `sha256:${sha256}`,
    source_file: basename(localPath),
    media_type: item.media_type,
    created_at: now,
    updated_at: now,
    technical: buildTechnical(item, jsonLd),
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
    source,
  }
}
