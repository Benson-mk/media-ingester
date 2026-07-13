import type { MediaTypeFilter, Provider, ProviderItem } from "./types"

const API_BASE_URL = "https://api.unsplash.com"
const MAX_PER_PAGE = 30
const LICENSE = "Unsplash License"
const LICENSE_URL = "https://unsplash.com/license"
const UTM_SOURCE = "media-ingester"
const UTM_MEDIUM = "referral"

type UnsplashTag = {
  title?: string
}

type UnsplashExif = {
  make?: string | null
  model?: string | null
  name?: string | null
  exposure_time?: string | number | null
  aperture?: string | number | null
  focal_length?: string | number | null
  iso?: string | number | null
}

type UnsplashLocation = {
  name?: string | null
  city?: string | null
  country?: string | null
}

type UnsplashPhoto = {
  id?: string
  width?: number
  height?: number
  description?: string | null
  alt_description?: string | null
  urls?: {
    full?: string
  }
  links?: {
    html?: string
    download_location?: string
  }
  user?: {
    name?: string | null
    links?: {
      html?: string
    }
  }
  tags?: UnsplashTag[]
  tags_preview?: UnsplashTag[]
  exif?: UnsplashExif | null
  location?: UnsplashLocation | null
}

type UnsplashSearchResponse = {
  total_pages?: number
  results?: UnsplashPhoto[]
}

function requireApiKey(): string {
  const key = process.env["UNSPLASH_ACCESS_KEY"]?.trim()
  if (!key) {
    throw new Error("UNSPLASH_ACCESS_KEY required for Unsplash provider")
  }
  return key
}

function requestHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Client-ID ${apiKey}`,
    "Accept-Version": "v1",
  }
}

async function apiGet(url: string, apiKey: string): Promise<unknown> {
  const response = await fetch(url, { headers: requestHeaders(apiKey) })
  if (!response.ok) {
    throw new Error(`Unsplash API error: ${response.status}`)
  }
  return response.json()
}

function firstText(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim()
  }
  return ""
}

function withAttribution(urlString: string): string {
  if (urlString.length === 0) return urlString
  try {
    const url = new URL(urlString)
    url.searchParams.set("utm_source", UTM_SOURCE)
    url.searchParams.set("utm_medium", UTM_MEDIUM)
    return url.toString()
  } catch {
    return urlString
  }
}

function creditsText(creatorName: string, profileUrl: string): string {
  const unsplashUrl = withAttribution("https://unsplash.com/")
  return `Photo by ${creatorName} (${profileUrl}) on Unsplash (${unsplashUrl})`
}

function mapTags(tags: readonly UnsplashTag[] | undefined): string[] {
  const seen = new Set<string>()
  const mapped: string[] = []
  for (const tag of tags ?? []) {
    const title = firstText(tag.title)
    const normalized = title.toLowerCase()
    if (normalized.length === 0 || seen.has(normalized)) continue
    seen.add(normalized)
    mapped.push(title)
  }
  return mapped
}

function exifValue(value: string | number): string | number {
  if (typeof value === "number") return value
  const numeric = Number(value)
  return value.trim().length > 0 && Number.isFinite(numeric) ? numeric : value
}

function mapExif(
  exif: UnsplashExif | null | undefined,
): Record<string, string | number> | undefined {
  if (!exif) return undefined

  const mapped: Record<string, string | number> = {}
  const make = firstText(exif.make)
  const model = firstText(exif.model, exif.name)
  if (make.length > 0) mapped["Make"] = make
  if (model.length > 0) mapped["Model"] = model

  if (exif.exposure_time !== undefined && exif.exposure_time !== null) {
    mapped["ExposureTime"] = exifValue(exif.exposure_time)
  }
  if (exif.aperture !== undefined && exif.aperture !== null) {
    mapped["FNumber"] = exifValue(exif.aperture)
  }
  if (exif.focal_length !== undefined && exif.focal_length !== null) {
    mapped["FocalLength"] = exifValue(exif.focal_length)
  }
  if (exif.iso !== undefined && exif.iso !== null) {
    mapped["ISO"] = exifValue(exif.iso)
  }

  return Object.keys(mapped).length > 0 ? mapped : undefined
}

function mapLocation(location: UnsplashLocation | null | undefined): string | undefined {
  if (!location) return undefined
  const name = firstText(location.name)
  if (name.length > 0) return name

  const parts = [firstText(location.city), firstText(location.country)].filter(Boolean)
  return parts.length > 0 ? [...new Set(parts)].join(", ") : undefined
}

function mapPhoto(photo: UnsplashPhoto, fallback?: ProviderItem): ProviderItem {
  const sourceId = firstText(photo.id, fallback?.source_id)
  const creatorName = firstText(photo.user?.name, fallback?.creator.name, "Unknown")
  const sourceUrl = withAttribution(firstText(photo.links?.html, fallback?.source_url))
  const profileUrl = withAttribution(
    firstText(photo.user?.links?.html, fallback?.creator.profile_url),
  )
  const title = firstText(photo.alt_description, photo.description, fallback?.title)
  const description = firstText(photo.description, photo.alt_description, fallback?.description)
  const detailTags = mapTags(photo.tags)
  const previewTags = mapTags(photo.tags_preview)
  const apiTags = detailTags.length > 0 ? detailTags : previewTags.length > 0 ? previewTags : []

  const item: ProviderItem = {
    provider: "unsplash",
    source_id: sourceId,
    media_type: "image",
    title,
    description,
    source_url: sourceUrl,
    download_url: firstText(photo.urls?.full, fallback?.download_url),
    creator: { name: creatorName, profile_url: profileUrl },
    license: LICENSE,
    license_url: LICENSE_URL,
    credits: {
      required: true,
      text: creditsText(creatorName, profileUrl),
    },
    api_tags: apiTags.length > 0 ? apiTags : (fallback?.api_tags ?? []),
    raw: photo,
  }

  if (photo.width !== undefined) item.width = photo.width
  else if (fallback?.width !== undefined) item.width = fallback.width
  if (photo.height !== undefined) item.height = photo.height
  else if (fallback?.height !== undefined) item.height = fallback.height

  const trackingUrl = firstText(photo.links?.download_location, fallback?.download_tracking_url)
  if (trackingUrl.length > 0) item.download_tracking_url = trackingUrl

  const exif = mapExif(photo.exif) ?? fallback?.exif
  if (exif !== undefined) item.exif = exif
  const location = mapLocation(photo.location) ?? fallback?.location
  if (location !== undefined) item.location = location

  return item
}

function originalSearchRaw(raw: unknown): unknown {
  if (typeof raw === "object" && raw !== null && "search" in raw && "detail" in raw) {
    return (raw as { search: unknown }).search
  }
  return raw
}

function requestedLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0
}

function searchUrl(query: string, page: number, perPage: number): string {
  const url = new URL("/search/photos", API_BASE_URL)
  url.searchParams.set("query", query)
  url.searchParams.set("page", String(page))
  url.searchParams.set("per_page", String(perPage))
  return url.toString()
}

function assertUnsplashImage(item: ProviderItem): void {
  if (item.provider !== "unsplash" || item.media_type !== "image") {
    throw new Error("Unsplash provider requires an Unsplash image item")
  }
}

function strictTrackingUrl(urlString: string, sourceId: string): string {
  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    throw new Error("Invalid Unsplash download tracking URL")
  }

  const expectedPath = `/photos/${encodeURIComponent(sourceId)}/download`
  if (
    url.protocol !== "https:" ||
    url.hostname !== "api.unsplash.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    (url.pathname !== expectedPath && url.pathname !== `${expectedPath}/`)
  ) {
    throw new Error("Invalid Unsplash download tracking URL")
  }
  return url.toString()
}

export const unsplashProvider = {
  id: "unsplash",
  supported: ["image"],

  async search(q: string, type: MediaTypeFilter, limit: number): Promise<ProviderItem[]> {
    if (type === "video" || type === "audio") return []

    const targetCount = requestedLimit(limit)
    if (targetCount === 0) return []
    const apiKey = requireApiKey()
    const items: ProviderItem[] = []
    let page = 1
    const perPage = Math.min(MAX_PER_PAGE, targetCount)

    while (items.length < targetCount) {
      const data = (await apiGet(searchUrl(q, page, perPage), apiKey)) as UnsplashSearchResponse
      const pageResults = data.results ?? []
      items.push(...pageResults.slice(0, perPage).map((photo) => mapPhoto(photo)))

      const reachedLastPage =
        pageResults.length < perPage ||
        (typeof data.total_pages === "number" && page >= data.total_pages)
      if (reachedLastPage) break
      page += 1
    }

    return items.slice(0, targetCount)
  },

  async getDetails(item: ProviderItem): Promise<ProviderItem> {
    assertUnsplashImage(item)
    const apiKey = requireApiKey()
    const url = new URL(`/photos/${encodeURIComponent(item.source_id)}`, API_BASE_URL).toString()
    const detail = (await apiGet(url, apiKey)) as UnsplashPhoto
    if (firstText(detail.id) !== item.source_id) {
      throw new Error("Unsplash detail response did not match the requested photo")
    }
    if (firstText(detail.urls?.full).length === 0) {
      throw new Error("Unsplash detail response missing urls.full")
    }
    if (firstText(detail.links?.download_location).length === 0) {
      throw new Error("Unsplash detail response missing download_location")
    }
    const hydrated = mapPhoto(detail, item)
    hydrated.raw = { search: originalSearchRaw(item.raw), detail }
    return hydrated
  },

  async trackDownload(item: ProviderItem): Promise<void> {
    assertUnsplashImage(item)
    const trackingUrl = item.download_tracking_url
    if (!trackingUrl) {
      throw new Error("Unsplash download tracking URL required")
    }
    const url = strictTrackingUrl(trackingUrl, item.source_id)
    const apiKey = requireApiKey()
    const response = await fetch(url, {
      headers: requestHeaders(apiKey),
      redirect: "error",
    })
    if (!response.ok) {
      throw new Error(`Unsplash download tracking error: ${response.status}`)
    }
  },
} satisfies Provider
