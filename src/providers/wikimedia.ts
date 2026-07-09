import type { MediaTypeFilter, Provider, ProviderItem } from "./types"

const API = "https://commons.wikimedia.org/w/api.php"
const USER_AGENT = "media-ingester/0.1 (personal use)"

type ExtValue = { value?: string }
type ExtMetadata = Record<string, ExtValue | undefined>

type ImageInfo = {
  url?: string
  mime?: string
  width?: number
  height?: number
  extmetadata?: ExtMetadata
}

type Page = {
  title?: string
  imageinfo?: ImageInfo[]
}

type SearchHit = { title?: string }

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "").trim()
}

function mediaTypeFromMime(mime: string): ProviderItem["media_type"] | null {
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("video/")) return "video"
  if (mime.startsWith("audio/")) return "audio"
  return null
}

function extValue(ext: ExtMetadata, key: string): string | undefined {
  return ext[key]?.value
}

async function apiGet(params: Record<string, string>): Promise<unknown> {
  const url = `${API}?${new URLSearchParams(params).toString()}`
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } })
  if (!response.ok) {
    throw new Error(`Wikimedia API error: ${response.status} for ${url}`)
  }
  return response.json()
}

function displayTitle(fileTitle: string): string {
  const withoutPrefix = fileTitle.replace(/^File:/, "")
  const dot = withoutPrefix.lastIndexOf(".")
  return dot > 0 ? withoutPrefix.slice(0, dot) : withoutPrefix
}

function mapPage(page: Page): ProviderItem | null {
  const title = page.title
  const info = page.imageinfo?.[0]
  if (!title || !info?.url || !info.mime) return null

  const mediaType = mediaTypeFromMime(info.mime)
  if (!mediaType) return null

  const ext: ExtMetadata = info.extmetadata ?? {}
  const license = extValue(ext, "LicenseShortName") ?? extValue(ext, "UsageTerms") ?? "unknown"
  const artist = extValue(ext, "Artist") ?? "Unknown"
  const descRaw = extValue(ext, "ImageDescription") ?? ""

  const item: ProviderItem = {
    provider: "wikimedia",
    source_id: title,
    media_type: mediaType,
    title: displayTitle(title),
    description: stripHtml(descRaw),
    source_url: `https://commons.wikimedia.org/wiki/${title.replace(/ /g, "_")}`,
    download_url: info.url,
    creator: { name: stripHtml(artist), profile_url: "" },
    license,
    license_url: "",
    api_tags: [],
    raw: page,
  }
  if (info.width !== undefined) item.width = info.width
  if (info.height !== undefined) item.height = info.height
  return item
}

function matchesFilter(item: ProviderItem, type: MediaTypeFilter): boolean {
  return type === "all" || item.media_type === type
}

export const wikimediaProvider: Provider = {
  id: "wikimedia",
  supported: ["image", "video", "audio"],

  async search(q: string, type: MediaTypeFilter, limit: number): Promise<ProviderItem[]> {
    const searchJson = await apiGet({
      action: "query",
      list: "search",
      srsearch: q,
      srnamespace: "6",
      srlimit: String(limit),
      format: "json",
      origin: "*",
    })

    const hits = (searchJson as { query?: { search?: SearchHit[] } }).query?.search ?? []
    const titles = hits.map((h) => h.title).filter((t): t is string => typeof t === "string")

    const items: ProviderItem[] = []
    for (const fileTitle of titles) {
      const detailJson = await apiGet({
        action: "query",
        titles: fileTitle,
        prop: "imageinfo",
        iiprop: "url|size|mime|extmetadata",
        format: "json",
        origin: "*",
      })

      const pages = (detailJson as { query?: { pages?: Record<string, Page> } }).query?.pages ?? {}
      for (const page of Object.values(pages)) {
        const item = mapPage(page)
        if (item && matchesFilter(item, type)) items.push(item)
      }
    }

    return items
  },
}
