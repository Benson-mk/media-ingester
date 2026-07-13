import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { logger } from "../common/logger"

export type PixabayBootstrapFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

export type PixabayBootstrapWarning = (
  message: string,
  fields?: Record<string, string | number | boolean | null>,
) => void

export type PixabayBootstrapOptions = {
  readonly fetch?: PixabayBootstrapFetch
  readonly cacheDir?: string
  readonly now?: () => number
  readonly warn?: PixabayBootstrapWarning
  readonly cookie?: string
}

export const PIXABAY_PAGE_SUCCESS_CACHE_TTL_MS = 24 * 60 * 60 * 1_000
export const PIXABAY_PAGE_FAILURE_CACHE_TTL_MS = 60 * 60 * 1_000
export const PIXABAY_ENRICHMENT_USER_AGENT =
  "media-ingester/1.0 (best-effort Pixabay metadata enrichment)"

type PixabayMediaItem = Record<string, unknown>

type CacheEntry =
  | {
      version: 1
      kind: "success"
      cachedAtMs: number
      mediaItem: PixabayMediaItem
    }
  | {
      version: 1
      kind: "failure"
      cachedAtMs: number
    }

type MediaItemResult =
  | { kind: "success"; mediaItem: PixabayMediaItem }
  | { kind: "missing" }
  | { kind: "mismatch" }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parsePixabayUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()
    if (url.protocol !== "https:") return null
    if (hostname !== "pixabay.com" && !hostname.endsWith(".pixabay.com")) return null
    return url
  } catch {
    return null
  }
}

function cacheKey(pageUrl: string, expectedSourceId: string): string {
  return createHash("sha256")
    .update("pixabay-page-v1\0")
    .update(expectedSourceId)
    .update("\0")
    .update(pageUrl)
    .digest("hex")
}

function parseCacheEntry(value: unknown): CacheEntry | null {
  if (!isRecord(value) || value["version"] !== 1) return null
  const cachedAtMs = value["cachedAtMs"]
  if (typeof cachedAtMs !== "number" || !Number.isFinite(cachedAtMs)) return null

  if (value["kind"] === "failure") {
    return { version: 1, kind: "failure", cachedAtMs }
  }
  if (value["kind"] !== "success" || !isRecord(value["mediaItem"])) return null
  return { version: 1, kind: "success", cachedAtMs, mediaItem: value["mediaItem"] }
}

async function readFreshCache(cachePath: string, nowMs: number): Promise<CacheEntry | null> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(cachePath, "utf8"))
  } catch {
    return null
  }

  const entry = parseCacheEntry(parsed)
  if (entry === null) return null
  const ageMs = nowMs - entry.cachedAtMs
  if (ageMs < 0) return null
  const ttlMs =
    entry.kind === "success" ? PIXABAY_PAGE_SUCCESS_CACHE_TTL_MS : PIXABAY_PAGE_FAILURE_CACHE_TTL_MS
  return ageMs < ttlMs ? entry : null
}

async function writeCache(cachePath: string, entry: CacheEntry): Promise<void> {
  await mkdir(dirname(cachePath), { recursive: true })
  const tempPath = `${cachePath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(tempPath, `${JSON.stringify(entry)}\n`, "utf8")
    await rename(tempPath, cachePath)
  } catch (error) {
    try {
      await unlink(tempPath)
    } catch {
      // The temporary file may not have been created.
    }
    throw error
  }
}

function assignmentValueOffsets(source: string, variableName: string): number[] {
  const marker = `window.${variableName}`
  const offsets: number[] = []
  let searchFrom = 0
  while (searchFrom < source.length) {
    const markerOffset = source.indexOf(marker, searchFrom)
    if (markerOffset < 0) break
    let cursor = markerOffset + marker.length
    while (/\s/.test(source[cursor] ?? "")) cursor += 1
    if (source[cursor] === "=") {
      cursor += 1
      while (/\s/.test(source[cursor] ?? "")) cursor += 1
      offsets.push(cursor)
    }
    searchFrom = markerOffset + marker.length
  }
  return offsets
}

function findJsonObjectEnd(source: string, start: number): number | null {
  if (source[start] !== "{") return null
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    if (character === undefined) break
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === "\\") {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }

    if (character === '"') {
      inString = true
    } else if (character === "{") {
      depth += 1
    } else if (character === "}") {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }
  return null
}

function parseInlineBootstrap(html: string): unknown | undefined {
  for (const offset of assignmentValueOffsets(html, "__BOOTSTRAP__")) {
    const end = findJsonObjectEnd(html, offset)
    if (end === null) continue
    try {
      return JSON.parse(html.slice(offset, end))
    } catch {
      // Try a later assignment or the bootstrap URL mode.
    }
  }
  return undefined
}

function parseHexEscape(source: string, start: number, length: number): string | undefined {
  const digits = source.slice(start, start + length)
  if (digits.length !== length || !/^[0-9a-f]+$/i.test(digits)) return undefined
  return String.fromCodePoint(Number.parseInt(digits, 16))
}

function parseAssignedJsString(source: string, variableName: string): string | undefined {
  for (const offset of assignmentValueOffsets(source, variableName)) {
    const quote = source[offset]
    if (quote !== '"' && quote !== "'") continue
    let value = ""
    for (let index = offset + 1; index < source.length; index += 1) {
      const character = source[index]
      if (character === undefined) break
      if (character === quote) return value
      if (character === "\n" || character === "\r") break
      if (character !== "\\") {
        value += character
        continue
      }

      index += 1
      const escaped = source[index]
      if (escaped === undefined) break
      const simpleEscapes: Record<string, string> = {
        "0": "\0",
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
        v: "\v",
      }
      const simple = simpleEscapes[escaped]
      if (simple !== undefined) {
        value += simple
        continue
      }
      if (escaped === "\n") continue
      if (escaped === "\r") {
        if (source[index + 1] === "\n") index += 1
        continue
      }
      if (escaped === "x") {
        const decoded = parseHexEscape(source, index + 1, 2)
        if (decoded === undefined) break
        value += decoded
        index += 2
        continue
      }
      if (escaped === "u") {
        if (source[index + 1] === "{") {
          const end = source.indexOf("}", index + 2)
          if (end < 0) break
          const digits = source.slice(index + 2, end)
          if (!/^[0-9a-f]{1,6}$/i.test(digits)) break
          const codePoint = Number.parseInt(digits, 16)
          if (codePoint > 0x10ffff) break
          value += String.fromCodePoint(codePoint)
          index = end
          continue
        }
        const decoded = parseHexEscape(source, index + 1, 4)
        if (decoded === undefined) break
        value += decoded
        index += 4
        continue
      }
      value += escaped
    }
  }
  return undefined
}

function extractMediaItem(bootstrap: unknown, expectedSourceId: string): MediaItemResult {
  if (!isRecord(bootstrap)) return { kind: "missing" }
  const page = bootstrap["page"]
  if (!isRecord(page)) return { kind: "missing" }
  const mediaItem = page["mediaItem"]
  if (!isRecord(mediaItem)) return { kind: "missing" }

  const id = mediaItem["id"]
  if ((typeof id !== "string" && typeof id !== "number") || String(id) !== expectedSourceId) {
    return { kind: "mismatch" }
  }
  return { kind: "success", mediaItem }
}

function cookiesFromResponse(response: Response): string | undefined {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  const setCookieValues = headers.getSetCookie?.() ?? []
  const values = setCookieValues.length > 0 ? setCookieValues : [response.headers.get("set-cookie")]
  const cookies = values
    .flatMap((value) => (value === null ? [] : [value.split(";", 1)[0]?.trim()]))
    .filter((value): value is string => value !== undefined && value.length > 0)
  return cookies.length === 0 ? undefined : cookies.join("; ")
}

function mergeCookies(first: string | undefined, second: string | undefined): string | undefined {
  const values = [first, second]
    .map((value) => value?.trim())
    .filter((value): value is string => value !== undefined && value.length > 0)
  return values.length === 0 ? undefined : values.join("; ")
}

function requestHeaders(accept: string, cookie: string | undefined, referer?: string): Headers {
  const headers = new Headers({
    accept,
    "user-agent": PIXABAY_ENRICHMENT_USER_AGENT,
  })
  if (cookie !== undefined && cookie.trim().length > 0) headers.set("cookie", cookie)
  if (referer !== undefined) headers.set("referer", referer)
  return headers
}

async function parseJsonResponse(response: Response): Promise<unknown | undefined> {
  try {
    return JSON.parse(await response.text())
  } catch {
    return undefined
  }
}

function decodeHtmlEntity(entity: string): string {
  const normalized = entity.toLowerCase()
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  }
  const namedValue = named[normalized]
  if (namedValue !== undefined) return namedValue

  const numeric = normalized.startsWith("#x")
    ? Number.parseInt(normalized.slice(2), 16)
    : normalized.startsWith("#")
      ? Number.parseInt(normalized.slice(1), 10)
      : Number.NaN
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 0x10ffff) return `&${entity};`
  if (numeric >= 0xd800 && numeric <= 0xdfff) return `&${entity};`
  return String.fromCodePoint(numeric)
}

/** Converts Pixabay's attribution HTML to inert, whitespace-normalized plain text. */
export function pixabayAttributionToText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1>|$)/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&([^;\s]+);/g, (_match, entity: string) => decodeHtmlEntity(entity))
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Best-effort extraction of Pixabay's undocumented page bootstrap metadata.
 * Only `page.mediaItem` is returned and cached; no other bootstrap state is retained.
 */
export async function fetchPixabayBootstrap(
  pageUrl: string,
  expectedSourceId: string,
  options: PixabayBootstrapOptions = {},
): Promise<PixabayMediaItem | null> {
  const fetchImpl = options.fetch ?? fetch
  const now = options.now ?? Date.now
  const warn = options.warn ?? logger.warn
  const parsedPageUrl = parsePixabayUrl(pageUrl)
  const normalizedId = expectedSourceId.trim()
  const key = cacheKey(pageUrl, normalizedId)
  const warningFields = { pageKey: key.slice(0, 12) }
  const cacheDir = options.cacheDir ?? join(process.cwd(), ".media_cache", "pixabay", "pages")
  const cachePath = join(cacheDir, `${key}.json`)

  async function store(entry: CacheEntry): Promise<void> {
    try {
      await writeCache(cachePath, entry)
    } catch {
      warn("pixabay page metadata cache write failed", warningFields)
    }
  }

  async function fail(
    message: string,
    fields: Record<string, string | number | boolean | null> = warningFields,
  ): Promise<null> {
    warn(message, fields)
    await store({ version: 1, kind: "failure", cachedAtMs: now() })
    return null
  }

  if (parsedPageUrl === null || normalizedId.length === 0) {
    return fail("pixabay page metadata request rejected")
  }

  const cached = await readFreshCache(cachePath, now())
  if (cached?.kind === "failure") {
    warn("pixabay page metadata unavailable (cached failure)", warningFields)
    return null
  }
  if (cached?.kind === "success") {
    const cachedResult = extractMediaItem({ page: { mediaItem: cached.mediaItem } }, normalizedId)
    if (cachedResult.kind === "success") return cachedResult.mediaItem
  }

  let pageResponse: Response
  try {
    pageResponse = await fetchImpl(parsedPageUrl, {
      credentials: "include",
      headers: requestHeaders("text/html,application/xhtml+xml", options.cookie),
      redirect: "follow",
    })
  } catch {
    return fail("pixabay page metadata fetch failed")
  }
  if (!pageResponse.ok) {
    return fail("pixabay page metadata fetch non-200", {
      ...warningFields,
      status: pageResponse.status,
    })
  }

  let html: string
  try {
    html = await pageResponse.text()
  } catch {
    return fail("pixabay page metadata response unreadable")
  }

  const inlineBootstrap = parseInlineBootstrap(html)
  if (inlineBootstrap !== undefined) {
    const inlineResult = extractMediaItem(inlineBootstrap, normalizedId)
    if (inlineResult.kind === "mismatch") {
      return fail("pixabay page metadata id mismatch")
    }
    if (inlineResult.kind === "success") {
      await store({
        version: 1,
        kind: "success",
        cachedAtMs: now(),
        mediaItem: inlineResult.mediaItem,
      })
      return inlineResult.mediaItem
    }
  }

  const bootstrapUrlValue = parseAssignedJsString(html, "__BOOTSTRAP_URL__")
  if (bootstrapUrlValue === undefined) {
    return fail("pixabay page metadata bootstrap missing or malformed")
  }

  let bootstrapUrl: URL
  try {
    bootstrapUrl = new URL(bootstrapUrlValue, parsedPageUrl)
  } catch {
    return fail("pixabay page metadata bootstrap URL malformed")
  }
  if (bootstrapUrl.origin !== parsedPageUrl.origin) {
    return fail("pixabay page metadata bootstrap URL is not same-origin")
  }

  const responseCookie = cookiesFromResponse(pageResponse)
  const cookie = mergeCookies(options.cookie, responseCookie)
  let bootstrapResponse: Response
  try {
    bootstrapResponse = await fetchImpl(bootstrapUrl, {
      credentials: "include",
      headers: requestHeaders("application/json", cookie, parsedPageUrl.toString()),
      // Do not let an undocumented bootstrap endpoint redirect the metadata request off-origin.
      redirect: "manual",
    })
  } catch {
    return fail("pixabay page metadata bootstrap fetch failed")
  }
  if (!bootstrapResponse.ok) {
    return fail("pixabay page metadata bootstrap fetch non-200", {
      ...warningFields,
      status: bootstrapResponse.status,
    })
  }

  const remoteBootstrap = await parseJsonResponse(bootstrapResponse)
  if (remoteBootstrap === undefined) {
    return fail("pixabay page metadata bootstrap JSON malformed")
  }
  const remoteResult = extractMediaItem(remoteBootstrap, normalizedId)
  if (remoteResult.kind === "mismatch") {
    return fail("pixabay page metadata id mismatch")
  }
  if (remoteResult.kind === "missing") {
    return fail("pixabay page metadata media item missing")
  }

  await store({
    version: 1,
    kind: "success",
    cachedAtMs: now(),
    mediaItem: remoteResult.mediaItem,
  })
  return remoteResult.mediaItem
}
