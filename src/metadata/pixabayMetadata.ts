import { pixabayAttributionToText } from "../crawl/pixabayBootstrap"
import type { ProviderItem } from "../providers/types"

export type PixabayBootstrapItem = Record<string, unknown> & {
  alt?: unknown
  aperture?: unknown
  attributionHtml?: unknown
  cameraName?: unknown
  contentIdCertificateUrl?: unknown
  description?: unknown
  downloadSources?: unknown
  exposureTime?: unknown
  fileFormat?: unknown
  flash?: unknown
  focalLength?: unknown
  height?: unknown
  id?: unknown
  isEditorsChoice?: unknown
  iso?: unknown
  lens?: unknown
  name?: unknown
  nsfw?: unknown
  primaryTag?: unknown
  publishedDate?: unknown
  qualityStatus?: unknown
  statusName?: unknown
  tagList?: unknown
  tags?: unknown
  uploadDate?: unknown
  user?: unknown
  vector?: unknown
  width?: unknown
}

type JsonRecord = Record<string, unknown>
type ExifValue = string | number | boolean

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function nonBlankString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  const text = nonBlankString(value)
  if (text === undefined) return undefined
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : undefined
}

function assignDefined(target: JsonRecord, key: string, value: unknown): void {
  if (value !== undefined && value !== null) target[key] = value
}

export function pixabayAttributionText(html: unknown): string | undefined {
  const input = nonBlankString(html)
  if (input === undefined) return undefined
  const text = pixabayAttributionToText(input)
  return text.length > 0 ? text : undefined
}

function assignExif(
  target: Record<string, ExifValue>,
  key: string,
  value: ExifValue | undefined,
): void {
  if (value !== undefined) target[key] = value
}

function stringOrNumber(value: unknown): string | number | undefined {
  const numeric = finiteNumber(value)
  if (numeric !== undefined) return numeric
  return nonBlankString(value)
}

export function pixabayBootstrapExif(
  bootstrap: PixabayBootstrapItem | null,
): Record<string, ExifValue> | undefined {
  if (bootstrap === null) return undefined
  const exif: Record<string, ExifValue> = {}
  assignExif(exif, "Model", nonBlankString(bootstrap.cameraName))
  assignExif(exif, "Lens", nonBlankString(bootstrap.lens))
  assignExif(exif, "FNumber", stringOrNumber(bootstrap.aperture))
  assignExif(exif, "ExposureTime", stringOrNumber(bootstrap.exposureTime))
  assignExif(exif, "FocalLength", stringOrNumber(bootstrap.focalLength))
  assignExif(exif, "ISO", stringOrNumber(bootstrap.iso))
  assignExif(exif, "Flash", typeof bootstrap.flash === "boolean" ? bootstrap.flash : undefined)
  return Object.keys(exif).length > 0 ? exif : undefined
}

function descriptiveMetadata(bootstrap: PixabayBootstrapItem): JsonRecord | undefined {
  const descriptive: JsonRecord = {}
  const fields: ReadonlyArray<readonly [string, string]> = [
    ["title", "title"],
    ["name", "name"],
    ["description", "description"],
    ["alt", "alt"],
    ["primary_tag", "primaryTag"],
    ["media_descriptive_type", "mediaDescriptiveType"],
    ["media_subtype", "mediaSubType"],
    ["media_type", "mediaType"],
    ["genres", "genres"],
    ["moods", "moods"],
    ["movements", "movements"],
    ["themes", "themes"],
    ["tags", "tags"],
    ["tag_list", "tagList"],
    ["tag_links", "tagLinks"],
    ["translated", "translated"],
    ["unreviewed_tags", "unreviewedTags"],
    ["language", "lang"],
  ]
  for (const [normalized, raw] of fields) assignDefined(descriptive, normalized, bootstrap[raw])
  return Object.keys(descriptive).length > 0 ? descriptive : undefined
}

export function mergePixabayProviderMetadata(
  item: ProviderItem,
  bootstrap: PixabayBootstrapItem | null,
): Record<string, unknown> | undefined {
  const metadata: JsonRecord = { ...(item.provider_metadata ?? {}) }
  if (bootstrap === null) {
    return Object.keys(metadata).length > 0 ? metadata : undefined
  }

  const exif = pixabayBootstrapExif(bootstrap)
  if (exif !== undefined) metadata["exif"] = exif

  const dates: JsonRecord = {}
  assignDefined(dates, "uploaded_at", bootstrap.uploadDate)
  assignDefined(dates, "published_at", bootstrap.publishedDate)
  if (Object.keys(dates).length > 0) metadata["dates"] = dates

  const curation: JsonRecord = {}
  assignDefined(curation, "editors_choice", bootstrap.isEditorsChoice)
  assignDefined(curation, "nsfw", bootstrap.nsfw)
  assignDefined(curation, "quality_status", bootstrap.qualityStatus)
  assignDefined(curation, "status_name", bootstrap.statusName)
  if (Object.keys(curation).length > 0) metadata["curation"] = curation

  const file: JsonRecord = {}
  assignDefined(file, "format", bootstrap.fileFormat)
  assignDefined(file, "vector", bootstrap.vector)
  assignDefined(file, "content_id_certificate_url", bootstrap.contentIdCertificateUrl)
  if (Object.keys(file).length > 0) metadata["file"] = file

  assignDefined(metadata, "download_variants", bootstrap.downloadSources)
  if (isRecord(bootstrap.user)) metadata["contributor"] = bootstrap.user

  const attribution = pixabayAttributionText(bootstrap.attributionHtml)
  if (attribution !== undefined) metadata["attribution_text"] = attribution

  const descriptive = descriptiveMetadata(bootstrap)
  if (descriptive !== undefined) metadata["descriptive"] = descriptive

  return Object.keys(metadata).length > 0 ? metadata : undefined
}

function tagValues(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
  }
  if (!Array.isArray(value)) return []
  const tags: string[] = []
  for (const entry of value) {
    const direct = nonBlankString(entry)
    if (direct !== undefined) {
      tags.push(direct)
      continue
    }
    if (!isRecord(entry)) continue
    const nested = nonBlankString(entry["name"]) ?? nonBlankString(entry["tag"])
    if (nested !== undefined) tags.push(nested)
  }
  return tags
}

export function pixabayBootstrapTags(bootstrap: PixabayBootstrapItem | null): string[] {
  if (bootstrap === null) return []
  return [
    ...tagValues(bootstrap.primaryTag),
    ...tagValues(bootstrap.tagList),
    ...tagValues(bootstrap.tags),
  ]
}

export function pixabayBootstrapTitle(bootstrap: PixabayBootstrapItem | null): string | undefined {
  return bootstrap === null ? undefined : nonBlankString(bootstrap.name)
}

export function pixabayBootstrapCaption(
  bootstrap: PixabayBootstrapItem | null,
  apiTags: readonly string[],
): string {
  if (bootstrap !== null) {
    const pageCaption = nonBlankString(bootstrap.description) ?? nonBlankString(bootstrap.alt)
    if (pageCaption !== undefined) return pageCaption
  }
  return apiTags.join(", ")
}
