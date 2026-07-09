import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { rawMetadataPath, sidecarPath } from "../common/paths"
import { MediaSidecarSchema } from "../common/schema"
import type { PexelsJsonLd } from "../crawl/extractJsonLd"
import type { ProviderItem } from "../providers/types"
import { buildExternalSidecar } from "./buildSidecar"
import { downloadAsset } from "./downloadAsset"
import { saveRaw } from "./saveRaw"

const originalFetch = global.fetch

function makePhotoItem(): ProviderItem {
  return {
    provider: "pexels",
    source_id: "12345",
    media_type: "image",
    title: "A mountain at sunset",
    description: "Beautiful mountain",
    source_url: "https://www.pexels.com/photo/12345/",
    download_url: "https://images.pexels.com/photos/12345/original.jpg",
    width: 4000,
    height: 3000,
    creator: { name: "Jane Doe", profile_url: "https://www.pexels.com/@jane" },
    license: "Pexels License",
    license_url: "https://www.pexels.com/license/",
    api_tags: ["nature", "outdoor"],
    raw: { id: 12345 },
  }
}

function makeVideoItem(): ProviderItem {
  return {
    provider: "pexels",
    source_id: "67890",
    media_type: "video",
    title: "Ocean waves",
    description: "Waves crashing",
    source_url: "https://www.pexels.com/video/67890/",
    download_url: "https://player.vimeo.com/1920.mp4",
    width: 1920,
    height: 1080,
    duration_seconds: 30,
    creator: { name: "John Smith", profile_url: "https://www.pexels.com/@john" },
    license: "Pexels License",
    license_url: "https://www.pexels.com/license/",
    api_tags: ["ocean"],
    raw: { id: 67890 },
  }
}

function makeWikimediaItem(): ProviderItem {
  return {
    provider: "wikimedia",
    source_id: "File:Example.jpg",
    media_type: "image",
    title: "Example",
    description: "An example file",
    source_url: "https://commons.wikimedia.org/wiki/File:Example.jpg",
    download_url: "https://upload.wikimedia.org/example.jpg",
    width: 800,
    height: 600,
    creator: { name: "Some Author", profile_url: "https://commons.wikimedia.org/wiki/User:X" },
    license: "CC BY-SA 4.0",
    license_url: "https://creativecommons.org/licenses/by-sa/4.0/",
    api_tags: ["landmark", "history"],
    raw: { pageid: 999 },
  }
}

let workDir: string

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "download-test-"))
})

afterEach(() => {
  global.fetch = originalFetch
  rmSync(workDir, { recursive: true, force: true })
})

test("buildExternalSidecar photo: exif + location + core tags, validates schema", () => {
  const item = { ...makePhotoItem(), api_tags: [] as string[] }
  const jsonLd: PexelsJsonLd = {
    keywords:
      "Mountain, Sunset, Sky, Peak, Snow, Nature, Landscape, Alpine, Rock, Cloud, Valley, Hill, Ridge, Summit, Vista, Scenery, Wild, Terrain, Range, Height, Forest, River",
    description: "A stunning mountain at sunset",
    contentLocation: { name: "Swiss Alps" },
    exifData: [
      { name: "iso", value: 100 },
      { name: "camera", value: "Canon EOS" },
    ],
  }
  const rawPath = "/tmp/x.external.raw.json"
  const sidecar = buildExternalSidecar(item, jsonLd, "/tmp/pexels-12345.jpg", "abc123", rawPath)

  expect(sidecar.external?.exif).toEqual({ iso: 100, camera: "Canon EOS" })
  expect(sidecar.external?.location).toBe("Swiss Alps")
  expect(sidecar.tags.core.length).toBeGreaterThanOrEqual(20)
  expect(sidecar.tags.core).toContain("mountain")
  expect(sidecar.external?.credits.text).toBe(
    "Photo by Jane Doe on Pexels: https://www.pexels.com/photo/12345/",
  )
  expect(sidecar.asset_id).toBe("sha256:abc123")
  expect(sidecar.external?.raw_metadata_path).toBe(rawPath)

  const result = MediaSidecarSchema.safeParse(sidecar)
  expect(result.success).toBe(true)
})

test("buildExternalSidecar video: no exif, no location, video credits label", () => {
  const item = makeVideoItem()
  const jsonLd: PexelsJsonLd = {
    keywords: "Ocean, Waves, Water",
    description: "Waves crashing on shore",
  }
  const sidecar = buildExternalSidecar(item, jsonLd, "/tmp/pexels-67890.mp4", "vid1", "/tmp/r.json")

  expect(sidecar.external?.exif).toBeUndefined()
  expect(sidecar.external?.location).toBeUndefined()
  expect(sidecar.external?.credits.text).toBe(
    "Video by John Smith on Pexels: https://www.pexels.com/video/67890/",
  )
  expect(sidecar.technical["duration_seconds"]).toBe(30)
  expect(sidecar.tags.core).toContain("ocean")
  expect(sidecar.tags.core).toContain("waves")

  const result = MediaSidecarSchema.safeParse(sidecar)
  expect(result.success).toBe(true)
})

test("buildExternalSidecar wikimedia: no jsonLd, tags from api_tags, no exif/location", () => {
  const item = makeWikimediaItem()
  const sidecar = buildExternalSidecar(item, null, "/tmp/wikimedia-x.jpg", "wiki1", "/tmp/r.json")

  expect(sidecar.external?.exif).toBeUndefined()
  expect(sidecar.external?.location).toBeUndefined()
  expect(sidecar.tags.core).toEqual(["landmark", "history"])
  expect(sidecar.external?.credits.text).toBe(
    "Photo by Some Author on Wikimedia: https://commons.wikimedia.org/wiki/File:Example.jpg",
  )
  expect(sidecar.summary.short_caption).toBe("An example file")

  const result = MediaSidecarSchema.safeParse(sidecar)
  expect(result.success).toBe(true)
})

test("downloadAsset success: writes file, returns sha256", async () => {
  global.fetch = mock(() =>
    Promise.resolve(new Response(new ArrayBuffer(8), { status: 200 })),
  ) as unknown as typeof fetch

  const result = await downloadAsset("https://example.com/a.jpg", workDir, "a.jpg")

  expect(existsSync(result.path)).toBe(true)
  expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
})

test("downloadAsset 404: throws, leaves no file on disk", async () => {
  global.fetch = mock(() =>
    Promise.resolve(new Response(null, { status: 404 })),
  ) as unknown as typeof fetch

  const target = join(workDir, "missing.jpg")
  await expect(
    downloadAsset("https://example.com/missing.jpg", workDir, "missing.jpg"),
  ).rejects.toThrow("Download failed: 404")
  expect(existsSync(target)).toBe(false)
})

test("downloadAsset write failure: unlinks partial file, rethrows", async () => {
  global.fetch = mock(() =>
    Promise.resolve(new Response(new ArrayBuffer(8), { status: 200 })),
  ) as unknown as typeof fetch
  const writeSpy = mock(() => Promise.reject(new Error("disk full")))
  const originalWrite = Bun.write
  Bun.write = writeSpy as unknown as typeof Bun.write

  const target = join(workDir, "fail.jpg")
  try {
    await expect(
      downloadAsset("https://example.com/fail.jpg", workDir, "fail.jpg"),
    ).rejects.toThrow("disk full")
    expect(existsSync(target)).toBe(false)
  } finally {
    Bun.write = originalWrite
  }
})

test("downloadAsset skip-existing: returns early without fetching", async () => {
  const filename = "exists.jpg"
  const target = join(workDir, filename)
  await Bun.write(target, new ArrayBuffer(8))
  await Bun.write(sidecarPath(target), "{}")

  const fetchSpy = mock(() => Promise.resolve(new Response(new ArrayBuffer(8), { status: 200 })))
  global.fetch = fetchSpy as unknown as typeof fetch

  const result = await downloadAsset("https://example.com/exists.jpg", workDir, filename)

  expect(result.path).toBe(target)
  expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
  expect(fetchSpy).not.toHaveBeenCalled()
})

test("saveRaw: writes api + json_ld to rawPath", async () => {
  const item = makePhotoItem()
  const jsonLd: PexelsJsonLd = { description: "hi" }
  const mediaPath = join(workDir, "media.jpg")
  const rawPath = rawMetadataPath(mediaPath)

  await saveRaw(rawPath, item, jsonLd)

  expect(existsSync(rawPath)).toBe(true)
  const written = (await Bun.file(rawPath).json()) as { api: unknown; json_ld: unknown }
  expect(written.api).toEqual({ id: 12345 })
  expect(written.json_ld).toEqual({ description: "hi" })
})
