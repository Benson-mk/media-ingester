import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { MediaTypeFilter, Provider, ProviderItem } from "./types"

const PIXABAY_IMAGE_URL = "https://pixabay.com/api/"
const PIXABAY_VIDEO_URL = "https://pixabay.com/api/videos/"
const PIXABAY_LICENSE = "Pixabay Content License"
const PIXABAY_LICENSE_URL = "https://pixabay.com/service/license-summary/"
const API_CACHE_TTL_MS = 24 * 60 * 60 * 1000

type JsonObject = Record<string, unknown>

type PixabayApiResponse = JsonObject & {
  hits: JsonObject[]
}

type CacheEnvelope = {
  version: 1
  cached_at_ms: number
  response: PixabayApiResponse
}

type PixabayProviderItem = ProviderItem & {
  provider_metadata?: Record<string, unknown>
}

export type PixabayProviderOptions = {
  readonly fetch?: typeof fetch
  readonly cacheDir?: string
  readonly now?: () => number
}

type EndpointKind = "image" | "video"

type SelectedRendition = {
  variant: string
  url: string
  width?: number
  height?: number
  size?: number
  thumbnail?: string
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isApiResponse(value: unknown): value is PixabayApiResponse {
  return (
    isObject(value) && Array.isArray(value["hits"]) && value["hits"].every((hit) => isObject(hit))
  )
}

function isCacheEnvelope(value: unknown): value is CacheEnvelope {
  return (
    isObject(value) &&
    value["version"] === 1 &&
    typeof value["cached_at_ms"] === "number" &&
    Number.isFinite(value["cached_at_ms"]) &&
    isApiResponse(value["response"])
  )
}

function errorCode(error: unknown): string | undefined {
  if (!isObject(error)) return undefined
  return typeof error["code"] === "string" ? error["code"] : undefined
}

function nonBlankString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function nonNegativeNumber(value: unknown): number | undefined {
  const number = finiteNumber(value)
  return number !== undefined && number >= 0 ? number : undefined
}

function positiveNumber(value: unknown): number | undefined {
  const number = finiteNumber(value)
  return number !== undefined && number > 0 ? number : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function assignDefined(target: JsonObject, key: string, value: unknown): void {
  if (value !== undefined) target[key] = value
}

function sourceId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return nonBlankString(value)
}

function parseTags(value: unknown): string[] {
  const tags = nonBlankString(value)
  if (tags === undefined) return []
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
}

function itemTitle(hit: JsonObject, tags: string[], id: string): string {
  return nonBlankString(hit["name"]) ?? tags[0] ?? id
}

function commonMetadata(hit: JsonObject): JsonObject {
  const metadata: JsonObject = {}
  assignDefined(metadata, "media_subtype", nonBlankString(hit["type"]))

  const flags: JsonObject = {}
  assignDefined(flags, "no_ai_training", booleanValue(hit["noAiTraining"]))
  assignDefined(flags, "is_ai_generated", booleanValue(hit["isAiGenerated"]))
  assignDefined(flags, "is_g_rated", booleanValue(hit["isGRated"]))
  assignDefined(flags, "is_low_quality", booleanValue(hit["isLowQuality"]))
  if (Object.keys(flags).length > 0) metadata["content_flags"] = flags

  const engagement: JsonObject = {}
  assignDefined(engagement, "views", nonNegativeNumber(hit["views"]))
  assignDefined(engagement, "downloads", nonNegativeNumber(hit["downloads"]))
  assignDefined(engagement, "collections", nonNegativeNumber(hit["collections"]))
  assignDefined(engagement, "likes", nonNegativeNumber(hit["likes"]))
  assignDefined(engagement, "comments", nonNegativeNumber(hit["comments"]))
  if (Object.keys(engagement).length > 0) metadata["engagement"] = engagement

  assignDefined(metadata, "contributor_avatar_url", nonBlankString(hit["userImageURL"]))
  return metadata
}

function renditionMetadata(rendition: SelectedRendition): JsonObject {
  const metadata: JsonObject = {
    variant: rendition.variant,
    url: rendition.url,
  }
  assignDefined(metadata, "width", rendition.width)
  assignDefined(metadata, "height", rendition.height)
  assignDefined(metadata, "size", rendition.size)
  assignDefined(metadata, "thumbnail", rendition.thumbnail)
  return metadata
}

function pickImageRendition(hit: JsonObject): SelectedRendition | undefined {
  const candidates = ["imageURL", "fullHDURL", "largeImageURL", "webformatURL"] as const
  for (const variant of candidates) {
    const url = nonBlankString(hit[variant])
    if (url === undefined) continue

    if (variant === "imageURL") {
      const rendition: SelectedRendition = { variant, url }
      const width = positiveNumber(hit["imageWidth"])
      const height = positiveNumber(hit["imageHeight"])
      const size = positiveNumber(hit["imageSize"])
      if (width !== undefined) rendition.width = width
      if (height !== undefined) rendition.height = height
      if (size !== undefined) rendition.size = size
      return rendition
    }

    if (variant === "webformatURL") {
      const rendition: SelectedRendition = { variant, url }
      const width = positiveNumber(hit["webformatWidth"])
      const height = positiveNumber(hit["webformatHeight"])
      if (width !== undefined) rendition.width = width
      if (height !== undefined) rendition.height = height
      return rendition
    }

    return { variant, url }
  }
  return undefined
}

function mapImage(hit: JsonObject): PixabayProviderItem | null {
  const id = sourceId(hit["id"])
  const sourceUrl = nonBlankString(hit["pageURL"])
  const rendition = pickImageRendition(hit)
  if (id === undefined || sourceUrl === undefined || rendition === undefined) return null

  const tags = parseTags(hit["tags"])
  const creatorName = nonBlankString(hit["user"]) ?? "Unknown"
  const metadata = commonMetadata(hit)
  const originalFile: JsonObject = {}
  assignDefined(originalFile, "width", positiveNumber(hit["imageWidth"]))
  assignDefined(originalFile, "height", positiveNumber(hit["imageHeight"]))
  assignDefined(originalFile, "size", positiveNumber(hit["imageSize"]))
  if (Object.keys(originalFile).length > 0) metadata["original_file"] = originalFile
  assignDefined(metadata, "vector_url", nonBlankString(hit["vectorURL"]))
  metadata["selected_rendition"] = renditionMetadata(rendition)

  const item: PixabayProviderItem = {
    provider: "pixabay",
    source_id: id,
    media_type: "image",
    title: itemTitle(hit, tags, id),
    description: tags.join(", "),
    source_url: sourceUrl,
    download_url: rendition.url,
    creator: {
      name: creatorName,
      profile_url: nonBlankString(hit["userURL"]) ?? "",
    },
    license: PIXABAY_LICENSE,
    license_url: PIXABAY_LICENSE_URL,
    credits: { required: false, text: `${creatorName} via Pixabay` },
    api_tags: tags,
    raw: hit,
    provider_metadata: metadata,
  }
  const thumbnail = nonBlankString(hit["previewURL"])
  if (thumbnail !== undefined) item.thumbnail_url = thumbnail
  const width = positiveNumber(hit["imageWidth"]) ?? rendition.width
  const height = positiveNumber(hit["imageHeight"]) ?? rendition.height
  if (width !== undefined) item.width = width
  if (height !== undefined) item.height = height
  return item
}

function normalizeVideoRendition(value: JsonObject): JsonObject {
  const rendition: JsonObject = {}
  assignDefined(rendition, "url", nonBlankString(value["url"]))
  assignDefined(rendition, "width", positiveNumber(value["width"]))
  assignDefined(rendition, "height", positiveNumber(value["height"]))
  assignDefined(rendition, "size", nonNegativeNumber(value["size"]))
  assignDefined(rendition, "thumbnail", nonBlankString(value["thumbnail"]))
  return rendition
}

function videoRenditions(hit: JsonObject): {
  selected: SelectedRendition | undefined
  available: JsonObject
} {
  if (!isObject(hit["videos"])) return { selected: undefined, available: {} }

  const available: JsonObject = {}
  let selected: SelectedRendition | undefined
  for (const [variant, rawRendition] of Object.entries(hit["videos"])) {
    if (!isObject(rawRendition)) continue
    const normalized = normalizeVideoRendition(rawRendition)
    if (Object.keys(normalized).length > 0) available[variant] = normalized

    const url = nonBlankString(rawRendition["url"])
    const size = positiveNumber(rawRendition["size"])
    if (url === undefined || size === undefined) continue

    const candidate: SelectedRendition = { variant, url, size }
    const width = positiveNumber(rawRendition["width"])
    const height = positiveNumber(rawRendition["height"])
    const thumbnail = nonBlankString(rawRendition["thumbnail"])
    if (width !== undefined) candidate.width = width
    if (height !== undefined) candidate.height = height
    if (thumbnail !== undefined) candidate.thumbnail = thumbnail
    const candidateWidth = candidate.width ?? 0
    const selectedWidth = selected?.width ?? 0
    if (
      selected === undefined ||
      candidateWidth > selectedWidth ||
      (candidateWidth === selectedWidth && size > (selected.size ?? 0))
    ) {
      selected = candidate
    }
  }
  return { selected, available }
}

function mapVideo(hit: JsonObject): PixabayProviderItem | null {
  const id = sourceId(hit["id"])
  const sourceUrl = nonBlankString(hit["pageURL"])
  const { selected, available } = videoRenditions(hit)
  if (id === undefined || sourceUrl === undefined || selected === undefined) return null

  const tags = parseTags(hit["tags"])
  const creatorName = nonBlankString(hit["user"]) ?? "Unknown"
  const metadata = commonMetadata(hit)
  metadata["selected_rendition"] = renditionMetadata(selected)
  if (Object.keys(available).length > 0) metadata["available_renditions"] = available

  const item: PixabayProviderItem = {
    provider: "pixabay",
    source_id: id,
    media_type: "video",
    title: itemTitle(hit, tags, id),
    description: tags.join(", "),
    source_url: sourceUrl,
    download_url: selected.url,
    creator: {
      name: creatorName,
      profile_url: nonBlankString(hit["userURL"]) ?? "",
    },
    license: PIXABAY_LICENSE,
    license_url: PIXABAY_LICENSE_URL,
    credits: { required: false, text: `${creatorName} via Pixabay` },
    api_tags: tags,
    raw: hit,
    provider_metadata: metadata,
  }
  if (selected.thumbnail !== undefined) item.thumbnail_url = selected.thumbnail
  if (selected.width !== undefined) item.width = selected.width
  if (selected.height !== undefined) item.height = selected.height
  const duration = nonNegativeNumber(hit["duration"])
  if (duration !== undefined) item.duration_seconds = duration
  return item
}

function requireApiKey(): string {
  const key = process.env["PIXABAY_API_KEY"]?.trim()
  if (key === undefined || key.length === 0) {
    throw new Error("PIXABAY_API_KEY required for Pixabay provider")
  }
  return key
}

function requestedLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return 0
  return Math.floor(limit)
}

function apiPerPage(limit: number): number {
  return Math.max(3, Math.min(200, limit))
}

function validateQuery(query: string): void {
  if (Array.from(query).length > 100) {
    throw new Error("Pixabay query must be at most 100 characters")
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function cacheFilename(
  cacheDir: string,
  kind: EndpointKind,
  query: string,
  perPage: number,
  apiKey: string,
): string {
  const keyFingerprint = sha256(apiKey)
  const canonicalParameters = new URLSearchParams({
    endpoint: kind,
    per_page: String(perPage),
    q: query,
    safesearch: "true",
  }).toString()
  return join(cacheDir, `${sha256(`${keyFingerprint}\n${canonicalParameters}`)}.json`)
}

async function readCache(filename: string, now: number): Promise<PixabayApiResponse | undefined> {
  let contents: string
  try {
    contents = await readFile(filename, "utf8")
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined
    throw new Error("Pixabay API cache read failed")
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch {
    return undefined
  }
  if (!isCacheEnvelope(parsed)) return undefined

  const age = now - parsed.cached_at_ms
  if (age < 0 || age >= API_CACHE_TTL_MS) return undefined
  return parsed.response
}

async function writeCache(
  cacheDir: string,
  filename: string,
  response: PixabayApiResponse,
  now: number,
): Promise<void> {
  const temporary = join(cacheDir, `.${randomUUID()}.tmp`)
  try {
    await mkdir(cacheDir, { recursive: true })
    const envelope: CacheEnvelope = { version: 1, cached_at_ms: now, response }
    await writeFile(temporary, `${JSON.stringify(envelope)}\n`, { encoding: "utf8", flag: "wx" })
    await rename(temporary, filename)
  } catch {
    try {
      await unlink(temporary)
    } catch {
      // The temporary file may not have been created.
    }
    throw new Error("Pixabay API cache write failed")
  }
}

export function createPixabayProvider(options: PixabayProviderOptions = {}): Provider {
  const cacheDir = options.cacheDir ?? join(process.cwd(), ".media_cache", "pixabay", "api")
  const now = options.now ?? Date.now

  async function apiSearch(
    kind: EndpointKind,
    query: string,
    limit: number,
    apiKey: string,
  ): Promise<ProviderItem[]> {
    const perPage = apiPerPage(limit)
    const cachePath = cacheFilename(cacheDir, kind, query, perPage, apiKey)
    let data = await readCache(cachePath, now())

    if (data === undefined) {
      const endpoint = kind === "image" ? PIXABAY_IMAGE_URL : PIXABAY_VIDEO_URL
      const parameters = new URLSearchParams({
        key: apiKey,
        q: query,
        safesearch: "true",
        per_page: String(perPage),
      })

      let response: Response
      try {
        const fetcher = options.fetch ?? globalThis.fetch
        response = await fetcher(`${endpoint}?${parameters.toString()}`)
      } catch {
        throw new Error("Pixabay API request failed")
      }
      if (!response.ok) {
        throw new Error(`Pixabay API error: ${response.status}`)
      }

      let json: unknown
      try {
        json = await response.json()
      } catch {
        throw new Error("Pixabay API returned invalid JSON")
      }
      if (!isApiResponse(json)) {
        throw new Error("Pixabay API returned an invalid response")
      }
      data = json
      await writeCache(cacheDir, cachePath, data, now())
    }

    const mapper = kind === "image" ? mapImage : mapVideo
    return data.hits
      .map((hit) => mapper(hit))
      .filter((item): item is PixabayProviderItem => item !== null)
      .slice(0, limit)
  }

  return {
    id: "pixabay",
    supported: ["image", "video"],
    async search(query: string, type: MediaTypeFilter, limit: number): Promise<ProviderItem[]> {
      const apiKey = requireApiKey()
      validateQuery(query)
      const normalizedLimit = requestedLimit(limit)
      if (normalizedLimit === 0) return []

      switch (type) {
        case "image":
          return apiSearch("image", query, normalizedLimit, apiKey)
        case "video":
          return apiSearch("video", query, normalizedLimit, apiKey)
        case "audio":
          return []
        case "all": {
          const images = await apiSearch("image", query, normalizedLimit, apiKey)
          const videos = await apiSearch("video", query, normalizedLimit, apiKey)
          return [...images, ...videos]
        }
      }
    },
  }
}

export const pixabayProvider: Provider = createPixabayProvider()
