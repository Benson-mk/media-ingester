import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  fetchPixabayBootstrap,
  PIXABAY_ENRICHMENT_USER_AGENT,
  PIXABAY_PAGE_FAILURE_CACHE_TTL_MS,
  PIXABAY_PAGE_SUCCESS_CACHE_TTL_MS,
  type PixabayBootstrapFetch,
  pixabayAttributionToText,
} from "./pixabayBootstrap"

const fixturesDir = join(import.meta.dir, "__fixtures__")
const pageUrl = "https://pixabay.com/photos/lake-swan-mountains-winter-nature-10359152/"
const sourceId = "10359152"
const tempDirs: string[] = []

async function fixture(name: string): Promise<string> {
  return readFile(join(fixturesDir, name), "utf8")
}

function inlineFixtureMediaItem(html: string): Record<string, unknown> {
  const marker = "window.__BOOTSTRAP__ = "
  const start = html.indexOf(marker) + marker.length
  const closing = html.lastIndexOf("\n      };")
  const bootstrap = JSON.parse(html.slice(start, closing + "\n      }".length)) as {
    page: { mediaItem: Record<string, unknown> }
  }
  return bootstrap.page.mediaItem
}

async function tempCacheDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pixabay-bootstrap-test-"))
  tempDirs.push(dir)
  return join(dir, "pages")
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("fetchPixabayBootstrap", () => {
  test("extracts and caches only page.mediaItem from an inline bootstrap", async () => {
    const html = await fixture("pixabay-bootstrap-inline.html")
    const cacheDir = await tempCacheDir()
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const fetchMock: PixabayBootstrapFetch = async (input, init) => {
      calls.push({ url: String(input), init })
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } })
    }

    const result = await fetchPixabayBootstrap(pageUrl, sourceId, {
      cacheDir,
      fetch: fetchMock,
      now: () => 1_000,
      warn: () => {},
    })

    const expectedMediaItem = inlineFixtureMediaItem(html)
    expect(result).not.toBeNull()
    expect(result).toEqual(expectedMediaItem)
    expect(result?.["cameraName"]).toBe("Sony Ilce-7rm3")
    expect(result?.["flash"]).toBe(false)
    expect(result?.["downloadSources"]).toEqual([
      {
        label: "1920×1280",
        width: 1920,
        height: 1280,
        size: 681223,
        url: "/download/example.jpg",
      },
    ])
    expect(result?.["request"]).toBeUndefined()
    expect(result?.["analytics"]).toBeUndefined()
    expect(calls).toHaveLength(1)
    expect(new Headers(calls[0]?.init?.headers).get("user-agent")).toBe(
      PIXABAY_ENRICHMENT_USER_AGENT,
    )
    expect(calls[0]?.init?.credentials).toBe("include")

    const cacheFiles = await readdir(cacheDir)
    expect(cacheFiles).toHaveLength(1)
    expect(cacheFiles[0]).toMatch(/^[a-f0-9]{64}\.json$/)
    const cacheText = await readFile(join(cacheDir, cacheFiles[0] ?? ""), "utf8")
    expect(cacheText).toContain('"mediaItem"')
    expect(cacheText).not.toContain("must-not-survive")
    expect(cacheText).not.toContain('"request"')
    expect(cacheText).not.toContain('"analytics"')

    const cached = await fetchPixabayBootstrap(pageUrl, sourceId, {
      cacheDir,
      fetch: fetchMock,
      now: () => 2_000,
      warn: () => {},
    })
    expect(cached).toEqual(result)
    expect(calls).toHaveLength(1)
  })

  test("follows a same-origin bootstrap URL with referer and available cookies", async () => {
    const html = await fixture("pixabay-bootstrap-url.html")
    const bootstrapJson = await fixture("pixabay-bootstrap-url.json")
    const cacheDir = await tempCacheDir()
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const fetchMock: PixabayBootstrapFetch = async (input, init) => {
      calls.push({ url: String(input), init })
      if (calls.length === 1) {
        return new Response(html, {
          status: 200,
          headers: { "set-cookie": "page_session=abc123; Path=/; HttpOnly; SameSite=Lax" },
        })
      }
      return new Response(bootstrapJson, {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }

    const result = await fetchPixabayBootstrap(pageUrl, sourceId, {
      cacheDir,
      cookie: "consent=yes",
      fetch: fetchMock,
      warn: () => {},
    })

    expect(result?.["name"]).toBe("Deferred Lake Swan")
    expect(calls).toHaveLength(2)
    expect(calls[1]?.url).toBe(
      "https://pixabay.com/bootstrap/media-10359152.json?token=ephemeral&mode=page",
    )
    const firstHeaders = new Headers(calls[0]?.init?.headers)
    const secondHeaders = new Headers(calls[1]?.init?.headers)
    expect(firstHeaders.get("cookie")).toBe("consent=yes")
    expect(secondHeaders.get("cookie")).toContain("consent=yes")
    expect(secondHeaders.get("cookie")).toContain("page_session=abc123")
    expect(secondHeaders.get("referer")).toBe(pageUrl)
    expect(secondHeaders.get("accept")).toBe("application/json")
    expect(calls[1]?.init?.credentials).toBe("include")
    expect(calls[1]?.init?.redirect).toBe("manual")

    const cacheText = await readFile(join(cacheDir, (await readdir(cacheDir))[0] ?? ""), "utf8")
    expect(cacheText).not.toContain("ephemeral")
    expect(cacheText).not.toContain("must-not-survive")
  })

  test("rejects a cross-origin bootstrap URL without requesting it", async () => {
    const cacheDir = await tempCacheDir()
    const html = '<script>window.__BOOTSTRAP_URL__ = "https://example.com/data.json";</script>'
    let calls = 0
    const warnings: string[] = []
    const fetchMock: PixabayBootstrapFetch = async () => {
      calls += 1
      return new Response(html)
    }

    const result = await fetchPixabayBootstrap(pageUrl, sourceId, {
      cacheDir,
      fetch: fetchMock,
      warn: (message) => warnings.push(message),
    })

    expect(result).toBeNull()
    expect(calls).toBe(1)
    expect(warnings).toContain("pixabay page metadata bootstrap URL is not same-origin")
  })

  test("403 creates a secret-free one-hour failure sentinel", async () => {
    const cacheDir = await tempCacheDir()
    const urlWithSecret = `${pageUrl}?key=do-not-persist-or-log`
    const warnings: string[] = []
    let nowMs = 10_000
    let calls = 0
    const fetchMock: PixabayBootstrapFetch = async () => {
      calls += 1
      return new Response("blocked", { status: 403 })
    }
    const options = {
      cacheDir,
      fetch: fetchMock,
      now: () => nowMs,
      warn: (message: string, fields?: Record<string, unknown>) =>
        warnings.push(`${message} ${JSON.stringify(fields)}`),
    }

    expect(await fetchPixabayBootstrap(urlWithSecret, sourceId, options)).toBeNull()
    nowMs += PIXABAY_PAGE_FAILURE_CACHE_TTL_MS - 1
    expect(await fetchPixabayBootstrap(urlWithSecret, sourceId, options)).toBeNull()
    expect(calls).toBe(1)

    const cacheFiles = await readdir(cacheDir)
    expect(cacheFiles).toHaveLength(1)
    const cacheText = await readFile(join(cacheDir, cacheFiles[0] ?? ""), "utf8")
    expect(cacheText).toContain('"kind":"failure"')
    expect(cacheText).not.toContain(sourceId)
    expect(cacheText).not.toContain("pixabay.com")
    expect(cacheText).not.toContain("do-not-persist-or-log")
    expect(warnings.join(" ")).not.toContain("do-not-persist-or-log")

    nowMs += 2
    expect(await fetchPixabayBootstrap(urlWithSecret, sourceId, options)).toBeNull()
    expect(calls).toBe(2)
  })

  test("malformed inline data warns and returns null", async () => {
    const cacheDir = await tempCacheDir()
    const warnings: string[] = []
    const fetchMock: PixabayBootstrapFetch = async () =>
      new Response("<script>window.__BOOTSTRAP__ = {not valid json};</script>")

    const result = await fetchPixabayBootstrap(pageUrl, sourceId, {
      cacheDir,
      fetch: fetchMock,
      warn: (message) => warnings.push(message),
    })

    expect(result).toBeNull()
    expect(warnings).toContain("pixabay page metadata bootstrap missing or malformed")
  })

  test("an inline media item with a different id is discarded", async () => {
    const cacheDir = await tempCacheDir()
    const warnings: string[] = []
    const html =
      '<script>window.__BOOTSTRAP__ = {"page":{"mediaItem":{"id":999,"name":"wrong"}}};</script>'
    const fetchMock: PixabayBootstrapFetch = async () => new Response(html)

    const result = await fetchPixabayBootstrap(pageUrl, sourceId, {
      cacheDir,
      fetch: fetchMock,
      warn: (message) => warnings.push(message),
    })

    expect(result).toBeNull()
    expect(warnings).toContain("pixabay page metadata id mismatch")
  })

  test("a failed second request is cached and not immediately retried", async () => {
    const cacheDir = await tempCacheDir()
    const html = await fixture("pixabay-bootstrap-url.html")
    const warnings: string[] = []
    let calls = 0
    const fetchMock: PixabayBootstrapFetch = async () => {
      calls += 1
      return calls % 2 === 1 ? new Response(html) : new Response("unavailable", { status: 503 })
    }

    expect(
      await fetchPixabayBootstrap(pageUrl, sourceId, {
        cacheDir,
        fetch: fetchMock,
        now: () => 5_000,
        warn: (message) => warnings.push(message),
      }),
    ).toBeNull()
    expect(calls).toBe(2)
    expect(warnings).toContain("pixabay page metadata bootstrap fetch non-200")

    expect(
      await fetchPixabayBootstrap(pageUrl, sourceId, {
        cacheDir,
        fetch: fetchMock,
        now: () => 5_001,
        warn: (message) => warnings.push(message),
      }),
    ).toBeNull()
    expect(calls).toBe(2)
    expect(warnings).toContain("pixabay page metadata unavailable (cached failure)")
  })

  test("malformed deferred JSON warns and falls back", async () => {
    const cacheDir = await tempCacheDir()
    const html = await fixture("pixabay-bootstrap-url.html")
    const warnings: string[] = []
    let calls = 0
    const fetchMock: PixabayBootstrapFetch = async () => {
      calls += 1
      return calls === 1 ? new Response(html) : new Response("not json")
    }

    const result = await fetchPixabayBootstrap(pageUrl, sourceId, {
      cacheDir,
      fetch: fetchMock,
      warn: (message) => warnings.push(message),
    })

    expect(result).toBeNull()
    expect(calls).toBe(2)
    expect(warnings).toContain("pixabay page metadata bootstrap JSON malformed")
  })

  test("a deferred bootstrap without page.mediaItem warns and falls back", async () => {
    const cacheDir = await tempCacheDir()
    const html = await fixture("pixabay-bootstrap-url.html")
    const warnings: string[] = []
    let calls = 0
    const fetchMock: PixabayBootstrapFetch = async () => {
      calls += 1
      return calls === 1 ? new Response(html) : Response.json({ page: {} })
    }

    const result = await fetchPixabayBootstrap(pageUrl, sourceId, {
      cacheDir,
      fetch: fetchMock,
      warn: (message) => warnings.push(message),
    })

    expect(result).toBeNull()
    expect(calls).toBe(2)
    expect(warnings).toContain("pixabay page metadata media item missing")
  })

  test("successful cached metadata expires after 24 hours", async () => {
    const cacheDir = await tempCacheDir()
    const html = await fixture("pixabay-bootstrap-inline.html")
    let nowMs = 20_000
    let calls = 0
    const fetchMock: PixabayBootstrapFetch = async () => {
      calls += 1
      return new Response(html)
    }
    const options = {
      cacheDir,
      fetch: fetchMock,
      now: () => nowMs,
      warn: () => {},
    }

    expect(await fetchPixabayBootstrap(pageUrl, sourceId, options)).not.toBeNull()
    nowMs += PIXABAY_PAGE_SUCCESS_CACHE_TTL_MS - 1
    expect(await fetchPixabayBootstrap(pageUrl, sourceId, options)).not.toBeNull()
    expect(calls).toBe(1)

    nowMs += 2
    expect(await fetchPixabayBootstrap(pageUrl, sourceId, options)).not.toBeNull()
    expect(calls).toBe(2)
  })
})

test("pixabayAttributionToText returns inert decoded plain text", () => {
  expect(
    pixabayAttributionToText(
      '<strong>Photo</strong> by <a href="https://example.test">A &amp; B</a><script>alert(1)</script>',
    ),
  ).toBe("Photo by A & B")
  expect(pixabayAttributionToText("Lens &#x1F4F7; &quot;Example&quot;")).toBe('Lens 📷 "Example"')
})
