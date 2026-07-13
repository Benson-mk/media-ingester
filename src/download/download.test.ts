import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { sidecarPath } from "../common/paths"
import { MediaSidecarSchema } from "../common/schema"
import type { PexelsJsonLd } from "../crawl/extractJsonLd"
import type { ProviderItem } from "../providers/types"
import { buildExternalSidecar } from "./buildSidecar"
import { downloadAsset } from "./downloadAsset"

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
      { name: "Camera", value: "Canon EOS" },
      { name: "Make", value: "Canon" },
      { name: "Focal length", value: "60.0" },
      { name: "Aperture", value: "2.8" },
      { name: "Exposure time", value: "0.003125" },
      { name: "ISO", value: 100 },
      { name: "Photographed", value: "2022-12-12T11:22:44.000Z" },
    ],
  }
  const sidecar = buildExternalSidecar(item, jsonLd, "/tmp/pexels-12345.jpg", "abc123")

  expect(sidecar.source?.origin).toBe("external")
  expect(sidecar.source?.exif).toEqual({
    Model: "Canon EOS",
    Make: "Canon",
    FocalLength: 60,
    FNumber: 2.8,
    ExposureTime: 0.003125,
    ISO: 100,
    DateTimeOriginal: "2022-12-12T11:22:44.000Z",
  })
  expect(sidecar.source?.location).toBe("Swiss Alps")
  expect(sidecar.tags.core.length).toBeGreaterThanOrEqual(20)
  expect(sidecar.tags.core).toContain("mountain")
  expect(sidecar.source?.credits?.text).toBe(
    "Photo by Jane Doe on Pexels: https://www.pexels.com/photo/12345/",
  )
  expect(sidecar.asset_id).toBe("sha256:abc123")
  expect(sidecar.source?.raw_metadata_path).toBeUndefined()
  expect(sidecar.source?.raw?.api).toEqual(item.raw)
  expect(sidecar.source?.raw?.json_ld).toEqual(jsonLd)
  expect(sidecar.source_file).toBe("/tmp/pexels-12345.jpg")
  expect(sidecar.technical).toEqual({
    width: 4000,
    height: 3000,
    orientation: null,
    aspect_ratio: "4:3",
  })

  const result = MediaSidecarSchema.safeParse(sidecar)
  expect(result.success).toBe(true)
})

test("buildExternalSidecar video: no exif, no location, video credits label", () => {
  const item = makeVideoItem()
  const jsonLd: PexelsJsonLd = {
    keywords: "Ocean, Waves, Water",
    description: "Waves crashing on shore",
  }
  const sidecar = buildExternalSidecar(item, jsonLd, "/tmp/pexels-67890.mp4", "vid1")

  expect(sidecar.source?.exif).toBeUndefined()
  expect(sidecar.source?.location).toBeUndefined()
  expect(sidecar.source?.credits?.text).toBe(
    "Video by John Smith on Pexels: https://www.pexels.com/video/67890/",
  )
  expect(sidecar.technical["duration"]).toBe(30)
  expect(sidecar.technical["duration_seconds"]).toBeUndefined()
  expect(sidecar.tags.core).toContain("ocean")
  expect(sidecar.tags.core).toContain("waves")

  const result = MediaSidecarSchema.safeParse(sidecar)
  expect(result.success).toBe(true)
})

test("buildExternalSidecar maps internal duration_seconds to media-tagger technical.duration", () => {
  const item = { ...makeVideoItem(), duration_seconds: 30 }
  const jsonLd: PexelsJsonLd = {
    description: "Waves crashing on shore",
    duration: "P0Y0M0DT0H0M5S",
  }
  const sidecar = buildExternalSidecar(item, jsonLd, "/tmp/pexels-67890.mp4", "vid2")

  expect(sidecar.technical["duration"]).toBe(5)
  expect(sidecar.technical["duration_seconds"]).toBeUndefined()
})

test("buildExternalSidecar wikimedia: embedded exif, tags from api_tags, no location", () => {
  const item = makeWikimediaItem()
  const embeddedExif = {
    Make: "Canon",
    Model: "Canon EOS 5D Mark III",
    ISO: 800,
    DateTimeOriginal: "2025-05-06T07:06:15.000Z",
  }
  const sidecar = buildExternalSidecar(item, null, "/tmp/wikimedia-x.jpg", "wiki1", embeddedExif)

  expect(sidecar.source?.exif).toEqual(embeddedExif)
  expect(sidecar.source?.location).toBeUndefined()
  expect(sidecar.source?.raw_metadata_path).toBeUndefined()
  expect(sidecar.source?.raw?.api).toEqual(item.raw)
  expect(sidecar.tags.core).toEqual(["landmark", "history"])
  expect(sidecar.source?.credits?.text).toBe(
    "Photo by Some Author on Wikimedia: https://commons.wikimedia.org/wiki/File:Example.jpg",
  )
  expect(sidecar.summary.short_caption).toBe("An example file")

  const result = MediaSidecarSchema.safeParse(sidecar)
  expect(result.success).toBe(true)
})

test("buildExternalSidecar uses provider credits and merges metadata with JSON-LD precedence", () => {
  const item: ProviderItem = {
    ...makePhotoItem(),
    credits: { required: true, text: "Photo by Jane Doe on Unsplash" },
    exif: { Make: "API Make", Model: "API Model", ISO: 200 },
    location: "API Location",
  }
  const jsonLd: PexelsJsonLd = {
    contentLocation: { name: "JSON-LD Location" },
    exifData: [
      { name: "Make", value: "JSON-LD Make" },
      { name: "ISO", value: 400 },
    ],
  }
  const sidecar = buildExternalSidecar(item, jsonLd, "/tmp/unsplash-12345.jpg", "credits1", {
    Model: "Embedded Model",
    ExposureTime: 0.01,
  })

  expect(sidecar.source?.credits).toEqual({
    required: true,
    text: "Photo by Jane Doe on Unsplash",
  })
  expect(sidecar.rights.notes).toBe("Photo by Jane Doe on Unsplash")
  expect(sidecar.source?.exif).toEqual({
    Make: "JSON-LD Make",
    Model: "Embedded Model",
    ISO: 400,
    ExposureTime: 0.01,
  })
  expect(sidecar.source?.location).toBe("JSON-LD Location")
})

test("buildExternalSidecar preserves and promotes Pixabay API plus bootstrap metadata", () => {
  const api = {
    id: 10359152,
    type: "photo",
    tags: "lake, swan, winter",
    views: 120,
    downloads: 30,
  }
  const bootstrap = {
    id: 10359152,
    name: "Swan on a winter lake",
    description: "A swan crossing an alpine lake in winter.",
    alt: "White swan with snowy mountains",
    cameraName: "Sony Ilce-7rm3",
    lens: "E 70-180mm F2.8 A056",
    aperture: "8.0",
    exposureTime: "1/320",
    focalLength: "82.0",
    iso: "100",
    flash: false,
    uploadDate: "2026-07-02T00:00:00Z",
    publishedDate: "2026-07-02T00:00:00Z",
    isEditorsChoice: true,
    nsfw: false,
    qualityStatus: "approved",
    fileFormat: "jpg",
    vector: false,
    downloadSources: [{ label: "Original", width: 7073, height: 4715 }],
    user: { id: 55, name: "RosZie", followerCount: 88 },
    attributionHtml: '<a href="https://pixabay.com/">Photo by RosZie &amp; Pixabay</a>',
    tagList: ["Lake", "Swan", "Mountains"],
    viewCount: 999,
  }
  const item: ProviderItem = {
    provider: "pixabay",
    source_id: "10359152",
    media_type: "image",
    title: "lake",
    description: "lake, swan, winter",
    source_url: "https://pixabay.com/photos/lake-swan-mountains-winter-nature-10359152/",
    download_url: "https://cdn.pixabay.com/photo.jpg",
    width: 7073,
    height: 4715,
    creator: { name: "RosZie", profile_url: "https://pixabay.com/users/roszie-55/" },
    license: "Pixabay Content License",
    license_url: "https://pixabay.com/service/license-summary/",
    credits: { required: false, text: "RosZie via Pixabay" },
    provider_metadata: {
      engagement: { views: 120, downloads: 30 },
      content_flags: { is_ai_generated: false },
    },
    api_tags: ["lake", "swan", "winter"],
    raw: api,
  }

  const sidecar = buildExternalSidecar(
    item,
    null,
    "/tmp/pixabay-10359152.jpg",
    "pixabay1",
    null,
    bootstrap,
  )

  expect(sidecar.summary.title).toBe("Swan on a winter lake")
  expect(sidecar.summary.short_caption).toBe("A swan crossing an alpine lake in winter.")
  expect(sidecar.source?.credits?.text).toBe("Photo by RosZie & Pixabay")
  expect(sidecar.source?.exif).toEqual({
    Model: "Sony Ilce-7rm3",
    Lens: "E 70-180mm F2.8 A056",
    FNumber: 8,
    ExposureTime: "1/320",
    FocalLength: 82,
    ISO: 100,
    Flash: false,
  })
  expect(sidecar.source?.raw?.api).toBe(api)
  expect(sidecar.source?.raw?.bootstrap).toBe(bootstrap)
  expect(sidecar.source?.provider_metadata?.["engagement"]).toEqual({
    views: 120,
    downloads: 30,
  })
  expect(sidecar.source?.provider_metadata?.["curation"]).toEqual({
    editors_choice: true,
    nsfw: false,
    quality_status: "approved",
  })
  expect(sidecar.tags.core).toEqual(["lake", "swan", "winter", "mountains"])
  expect(MediaSidecarSchema.safeParse(sidecar).success).toBe(true)
})

test("downloadAsset success: writes file, returns sha256", async () => {
  global.fetch = mock(() =>
    Promise.resolve(new Response(new ArrayBuffer(8), { status: 200 })),
  ) as unknown as typeof fetch

  const result = await downloadAsset("https://example.com/a.jpg", workDir, "a.jpg")

  expect(existsSync(result.path)).toBe(true)
  expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
  expect(result.downloaded).toBe(true)
})

test("downloadAsset prepares after the skip check and downloads the returned URL", async () => {
  const calls: string[] = []
  const prepareDownload = mock(async () => {
    calls.push("prepare")
    return "https://cdn.example.com/final.jpg"
  })
  global.fetch = mock((input: string | URL | Request) => {
    calls.push(typeof input === "string" ? input : input.toString())
    return Promise.resolve(new Response(new ArrayBuffer(8), { status: 200 }))
  }) as unknown as typeof fetch

  const result = await downloadAsset("https://example.com/summary.jpg", workDir, "final.jpg", {
    prepareDownload,
  })

  expect(calls).toEqual(["prepare", "https://cdn.example.com/final.jpg"])
  expect(result.downloaded).toBe(true)
})

test("downloadAsset preparation failure blocks fetch and file creation", async () => {
  const fetchSpy = mock(() => Promise.resolve(new Response(new ArrayBuffer(8), { status: 200 })))
  global.fetch = fetchSpy as unknown as typeof fetch
  const target = join(workDir, "blocked.jpg")

  await expect(
    downloadAsset("https://example.com/summary.jpg", workDir, "blocked.jpg", {
      prepareDownload: async () => {
        throw new Error("tracking failed")
      },
    }),
  ).rejects.toThrow("tracking failed")

  expect(fetchSpy).not.toHaveBeenCalled()
  expect(existsSync(target)).toBe(false)
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
  const prepareSpy = mock(() => Promise.resolve("https://example.com/prepared.jpg"))
  global.fetch = fetchSpy as unknown as typeof fetch

  const result = await downloadAsset("https://example.com/exists.jpg", workDir, filename, {
    prepareDownload: prepareSpy,
  })

  expect(result.path).toBe(target)
  expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
  expect(result.downloaded).toBe(false)
  expect(prepareSpy).not.toHaveBeenCalled()
  expect(fetchSpy).not.toHaveBeenCalled()
})
