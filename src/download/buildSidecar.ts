import { parseIsoDuration } from "../common/parseIsoDuration"
import type { MediaSidecar, SourceBlock } from "../common/schema"
import type { PexelsJsonLd } from "../crawl/extractPexelsJsonLd"
import type { ExifData } from "../metadata/extractExif"
import {
  mergePixabayProviderMetadata,
  type PixabayBootstrapItem,
  pixabayAttributionText,
  pixabayBootstrapCaption,
  pixabayBootstrapExif,
  pixabayBootstrapTags,
  pixabayBootstrapTitle,
} from "../metadata/pixabayMetadata"
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

function buildCoreTags(
  item: ProviderItem,
  jsonLd: PexelsJsonLd | null,
  pixabayBootstrap: PixabayBootstrapItem | null,
): string[] {
  const fromJsonLd =
    jsonLd?.keywords
      ?.split(", ")
      .map((tag) => tag.trim())
      .filter(Boolean) ?? []
  const seen = new Set<string>()
  const out: string[] = []
  for (const tag of [...item.api_tags, ...pixabayBootstrapTags(pixabayBootstrap), ...fromJsonLd]) {
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
  pixabayBootstrap: PixabayBootstrapItem | null,
): Record<string, string | number | boolean | null> {
  const duration =
    jsonLd?.duration !== undefined ? parseIsoDuration(jsonLd.duration) : item.duration_seconds
  const technical: {
    width?: number
    height?: number
    duration?: number
    orientation?: number | null
    aspect_ratio?: string
  } = {}
  const bootstrapWidth =
    typeof pixabayBootstrap?.width === "number" && Number.isFinite(pixabayBootstrap.width)
      ? pixabayBootstrap.width
      : undefined
  const bootstrapHeight =
    typeof pixabayBootstrap?.height === "number" && Number.isFinite(pixabayBootstrap.height)
      ? pixabayBootstrap.height
      : undefined
  const width = item.width ?? bootstrapWidth
  const height = item.height ?? bootstrapHeight
  if (width !== undefined) technical.width = width
  if (height !== undefined) technical.height = height
  if (duration !== undefined) technical.duration = duration
  if (
    item.media_type === "image" &&
    width !== undefined &&
    height !== undefined &&
    width > 0 &&
    height > 0
  ) {
    technical.orientation =
      typeof item.exif?.["Orientation"] === "number" ? item.exif["Orientation"] : null
    technical.aspect_ratio = aspectRatio(width, height)
  }
  return technical
}

function aspectRatio(width: number, height: number): string {
  const divisor = greatestCommonDivisor(width, height)
  return `${width / divisor}:${height / divisor}`
}

function greatestCommonDivisor(left: number, right: number): number {
  let current = Math.round(left)
  let next = Math.round(right)
  while (next !== 0) {
    const remainder = current % next
    current = next
    next = remainder
  }
  return Math.abs(current) || 1
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

function buildJsonLdExif(jsonLd: PexelsJsonLd | null): Record<string, string | number> | undefined {
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

function buildExif(
  item: ProviderItem,
  jsonLd: PexelsJsonLd | null,
  embeddedExif: ExifData | null,
  pixabayBootstrap: PixabayBootstrapItem | null,
): Record<string, string | number | boolean> | undefined {
  const exif = {
    ...item.exif,
    ...(embeddedExif ?? {}),
    ...pixabayBootstrapExif(pixabayBootstrap),
    ...buildJsonLdExif(jsonLd),
  }
  return Object.keys(exif).length > 0 ? exif : undefined
}

export function buildExternalSidecar(
  item: ProviderItem,
  jsonLd: PexelsJsonLd | null,
  localPath: string,
  sha256: string,
  embeddedExif: ExifData | null = null,
  pixabayBootstrap: PixabayBootstrapItem | null = null,
): MediaSidecar {
  const now = new Date().toISOString()
  const fallbackCreditsText = `${mediaTypeLabel(item.media_type)} by ${item.creator.name} on ${providerLabel(item.provider)}: ${item.source_url}`
  const pageAttribution =
    item.provider === "pixabay"
      ? pixabayAttributionText(pixabayBootstrap?.attributionHtml)
      : undefined
  const credits =
    pageAttribution === undefined
      ? (item.credits ?? { required: false, text: fallbackCreditsText })
      : { required: item.credits?.required ?? false, text: pageAttribution }

  const raw: NonNullable<SourceBlock["raw"]> = {
    api: item.raw,
    json_ld: jsonLd,
  }
  if (pixabayBootstrap !== null) raw.bootstrap = pixabayBootstrap

  const source: SourceBlock = {
    origin: "external",
    provider: item.provider,
    source_id: item.source_id,
    source_url: item.source_url,
    download_url: item.download_url,
    creator: item.creator,
    license: item.license,
    license_url: item.license_url,
    credits,
    raw,
  }

  const providerMetadata =
    item.provider === "pixabay"
      ? mergePixabayProviderMetadata(item, pixabayBootstrap)
      : item.provider_metadata
  if (providerMetadata !== undefined) source.provider_metadata = providerMetadata

  const exif = buildExif(item, jsonLd, embeddedExif, pixabayBootstrap)
  if (exif !== undefined) source.exif = exif
  const location = jsonLd?.contentLocation?.name ?? item.location
  if (location !== undefined) source.location = location

  const pageTitle =
    item.provider === "pixabay" ? pixabayBootstrapTitle(pixabayBootstrap) : undefined
  const title = pageTitle ?? (item.title || (jsonLd?.description?.slice(0, 100) ?? ""))
  const shortCaption =
    item.provider === "pixabay"
      ? pixabayBootstrapCaption(pixabayBootstrap, item.api_tags)
      : (jsonLd?.description ?? item.description)

  return {
    schema_version: "1.1",
    asset_id: `sha256:${sha256}`,
    source_file: localPath,
    media_type: item.media_type,
    created_at: now,
    updated_at: now,
    technical: buildTechnical(item, jsonLd, pixabayBootstrap),
    summary: {
      title,
      short_caption: shortCaption,
      detailed_caption: "",
      best_use: [],
      not_recommended_for: [],
    },
    tags: {
      core: buildCoreTags(item, jsonLd, pixabayBootstrap),
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
      notes: credits.text,
    },
    api_usage: {
      provider: "none",
      model: "none",
      media_uploaded_to_api: false,
    },
    source,
  }
}
