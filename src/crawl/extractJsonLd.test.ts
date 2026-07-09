import { afterEach, expect, mock, test } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import { fetchPexelsJsonLd } from "./extractJsonLd"

const fixturesDir = path.join(import.meta.dir, "__fixtures__")

function readFixture(name: string): string {
  return fs.readFileSync(path.join(fixturesDir, name), "utf8")
}

function htmlResponse(html: string): Response {
  return new Response(html, { status: 200, headers: { "content-type": "text/html" } })
}

const origFetch = global.fetch
afterEach(() => {
  global.fetch = origFetch
})

test("photo fixture: keywords, exif, contentLocation", async () => {
  const html = readFixture("pexels-photo.html")
  global.fetch = mock(() => Promise.resolve(htmlResponse(html))) as unknown as typeof fetch
  const result = await fetchPexelsJsonLd("https://www.pexels.com/photo/x-34081631/")
  expect(result).not.toBeNull()
  const tags = result?.keywords?.split(", ") ?? []
  expect(tags.length).toBeGreaterThanOrEqual(20)
  expect(result?.contentLocation?.name).toBe("Grand Rapids, Michigan, United States")
  const exifNames = result?.exifData?.map((e) => e.name) ?? []
  expect(exifNames).toContain("Make")
  expect(exifNames).toContain("Model")
  expect(result?.contentUrl).toBe(
    "https://images.pexels.com/photos/34081631/pexels-photo-34081631.jpeg",
  )
  expect(result?.creator?.name).toBe("Test Photographer")
})

test("video fixture: keywords + duration, no exif, no contentLocation", async () => {
  const html = readFixture("pexels-video.html")
  global.fetch = mock(() => Promise.resolve(htmlResponse(html))) as unknown as typeof fetch
  const result = await fetchPexelsJsonLd("https://www.pexels.com/video/x-38467086/")
  expect(result).not.toBeNull()
  expect((result?.keywords?.split(", ") ?? []).length).toBeGreaterThan(0)
  expect(result?.duration).toBe("P0Y0M0DT0H0M5S")
  expect(result?.exifData).toBeUndefined()
  expect(result?.contentLocation).toBeUndefined()
})

test("403 response returns null without throwing", async () => {
  global.fetch = mock(() =>
    Promise.resolve(new Response("", { status: 403 })),
  ) as unknown as typeof fetch
  const result = await fetchPexelsJsonLd("https://www.pexels.com/photo/blocked/")
  expect(result).toBeNull()
})

test("malformed JSON in script tag returns null", async () => {
  const html =
    '<html><head><script type="application/ld+json">{not valid json}</script></head></html>'
  global.fetch = mock(() => Promise.resolve(htmlResponse(html))) as unknown as typeof fetch
  const result = await fetchPexelsJsonLd("https://www.pexels.com/photo/bad/")
  expect(result).toBeNull()
})

test("no ld+json block returns null", async () => {
  const html = "<html><head><title>plain</title></head><body>hi</body></html>"
  global.fetch = mock(() => Promise.resolve(htmlResponse(html))) as unknown as typeof fetch
  const result = await fetchPexelsJsonLd("https://www.pexels.com/photo/plain/")
  expect(result).toBeNull()
})
