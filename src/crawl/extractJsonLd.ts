import { logger } from "../common/logger"

export type PexelsJsonLd = {
  keywords?: string
  description?: string
  duration?: string
  creator?: { name: string; url: string }
  license?: string
  contentLocation?: { name: string }
  exifData?: Array<{ name: string; value: string | number }>
  contentUrl?: string
}

type RawBlock = {
  "@type"?: unknown
  keywords?: unknown
  description?: unknown
  duration?: unknown
  license?: unknown
  contentUrl?: unknown
  creator?: unknown
  contentLocation?: unknown
  exifData?: unknown
}

type RawNamed = { name?: unknown; url?: unknown; value?: unknown }

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
const SCRIPT_OPEN = '<script type="application/ld+json">'
const SCRIPT_CLOSE = "</script>"

function parseLdJsonBlocks(html: string): RawBlock[] {
  const blocks: RawBlock[] = []
  let pos = 0
  while (true) {
    const start = html.indexOf(SCRIPT_OPEN, pos)
    if (start === -1) break
    const contentStart = html.indexOf(">", start) + 1
    const contentEnd = html.indexOf(SCRIPT_CLOSE, contentStart)
    if (contentEnd === -1) break
    try {
      const parsed: unknown = JSON.parse(html.slice(contentStart, contentEnd))
      if (typeof parsed === "object" && parsed !== null) {
        blocks.push(parsed as RawBlock)
      }
    } catch {
      // skip malformed block
    }
    pos = contentEnd + SCRIPT_CLOSE.length
  }
  return blocks
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function extractCreator(value: unknown): PexelsJsonLd["creator"] {
  if (typeof value !== "object" || value === null) return undefined
  const obj = value as RawNamed
  const name = asString(obj.name)
  const url = asString(obj.url)
  if (name === undefined || url === undefined) return undefined
  return { name, url }
}

function extractContentLocation(value: unknown): PexelsJsonLd["contentLocation"] {
  if (typeof value !== "object" || value === null) return undefined
  const name = asString((value as RawNamed).name)
  if (name === undefined) return undefined
  return { name }
}

function extractExifData(value: unknown): PexelsJsonLd["exifData"] {
  if (!Array.isArray(value)) return undefined
  const out: Array<{ name: string; value: string | number }> = []
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue
    const obj = entry as RawNamed
    const name = asString(obj.name)
    const raw = obj.value
    if (name === undefined) continue
    if (typeof raw !== "string" && typeof raw !== "number") continue
    out.push({ name, value: raw })
  }
  return out.length === 0 ? undefined : out
}

function extractFromBlock(block: RawBlock): PexelsJsonLd {
  const result: PexelsJsonLd = {}
  const keywords = asString(block.keywords)
  if (keywords !== undefined) result.keywords = keywords
  const description = asString(block.description)
  if (description !== undefined) result.description = description
  const duration = asString(block.duration)
  if (duration !== undefined) result.duration = duration
  const license = asString(block.license)
  if (license !== undefined) result.license = license
  const contentUrl = asString(block.contentUrl)
  if (contentUrl !== undefined) result.contentUrl = contentUrl
  const creator = extractCreator(block.creator)
  if (creator !== undefined) result.creator = creator
  const contentLocation = extractContentLocation(block.contentLocation)
  if (contentLocation !== undefined) result.contentLocation = contentLocation
  const exifData = extractExifData(block.exifData)
  if (exifData !== undefined) result.exifData = exifData
  return result
}

export async function fetchPexelsJsonLd(pageUrl: string): Promise<PexelsJsonLd | null> {
  let html: string
  try {
    const response = await fetch(pageUrl, { headers: { "user-agent": USER_AGENT } })
    if (!response.ok) {
      logger.warn("pexels page fetch non-200", { pageUrl, status: response.status })
      return null
    }
    html = await response.text()
  } catch (error) {
    logger.warn("pexels page fetch failed", { pageUrl, error: String(error) })
    return null
  }

  const blocks = parseLdJsonBlocks(html)
  const match = blocks.find((block) => {
    const type = block["@type"]
    return type === "ImageObject" || type === "VideoObject"
  })
  if (match === undefined) {
    logger.warn("pexels page has no ImageObject/VideoObject ld+json", { pageUrl })
    return null
  }
  return extractFromBlock(match)
}
