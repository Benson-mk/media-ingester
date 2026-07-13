import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createPixabayProvider } from "./pixabay"
import type { ProviderItem } from "./types"

const IMAGE_HIT = {
  id: 10359152,
  name: "Lake Swan Mountains Winter Nature",
  type: "photo",
  tags: "lake, swan, winter nature",
  pageURL: "https://pixabay.com/photos/lake-swan-10359152/",
  previewURL: "https://cdn.example/preview.jpg",
  previewWidth: 150,
  previewHeight: 100,
  webformatURL: "https://cdn.example/web.jpg",
  webformatWidth: 640,
  webformatHeight: 426,
  largeImageURL: "https://cdn.example/large.jpg",
  fullHDURL: "https://cdn.example/full-hd.jpg",
  imageURL: "https://cdn.example/original.jpg",
  vectorURL: "https://cdn.example/original.svg",
  imageWidth: 6000,
  imageHeight: 4000,
  imageSize: 8_765_432,
  views: 1000,
  downloads: 250,
  collections: 12,
  likes: 80,
  comments: 7,
  user_id: 42,
  user: "Lake Artist",
  userURL: "https://pixabay.com/users/lake-artist-42/",
  userImageURL: "https://cdn.example/avatar.jpg",
  noAiTraining: true,
  isAiGenerated: false,
  isGRated: true,
  isLowQuality: false,
  futureApiField: { retained: true },
}

const VIDEO_HIT = {
  id: 98765,
  name: "Snowy mountain film",
  type: "film",
  tags: "snow, mountain, winter",
  pageURL: "https://pixabay.com/videos/snow-mountain-98765/",
  duration: 18,
  views: 900,
  downloads: 100,
  likes: 25,
  comments: 2,
  user_id: 77,
  user: "Video Maker",
  userURL: "https://pixabay.com/users/video-maker-77/",
  userImageURL: "https://cdn.example/video-avatar.jpg",
  noAiTraining: false,
  isAiGenerated: true,
  isGRated: true,
  isLowQuality: false,
  videos: {
    large: {
      url: "https://cdn.example/video-large.mp4",
      width: 1920,
      height: 1080,
      size: 20_000_000,
      thumbnail: "https://cdn.example/video-large.jpg",
    },
    medium: {
      url: "https://cdn.example/video-medium.mp4",
      width: 1280,
      height: 720,
      size: 8_000_000,
      thumbnail: "https://cdn.example/video-medium.jpg",
    },
    small: {
      url: "https://cdn.example/video-small.mp4",
      width: 960,
      height: 540,
      size: 4_000_000,
      thumbnail: "https://cdn.example/video-small.jpg",
    },
    tiny: {
      url: "https://cdn.example/video-tiny.mp4",
      width: 640,
      height: 360,
      size: 2_000_000,
      thumbnail: "https://cdn.example/video-tiny.jpg",
    },
  },
  futureVideoField: "retained",
}

const originalApiKey = process.env["PIXABAY_API_KEY"]
let cacheDir = ""

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "pixabay-provider-"))
  process.env["PIXABAY_API_KEY"] = "test-secret"
})

afterEach(async () => {
  if (originalApiKey === undefined) delete process.env["PIXABAY_API_KEY"]
  else process.env["PIXABAY_API_KEY"] = originalApiKey
  await rm(cacheDir, { force: true, recursive: true })
})

type FetchHarness = {
  readonly fetch: typeof fetch
  readonly urls: string[]
  readonly callCount: () => number
}

function jsonFetch(bodyForUrl: (url: string, call: number) => unknown, status = 200): FetchHarness {
  const urls: string[] = []
  let calls = 0
  const fetcher = mock(async (input: string | URL | Request) => {
    const url = String(input)
    urls.push(url)
    calls += 1
    return new Response(JSON.stringify(bodyForUrl(url, calls)), { status })
  }) as unknown as typeof fetch
  return { fetch: fetcher, urls, callCount: () => calls }
}

function metadata(item: ProviderItem | undefined): Record<string, unknown> {
  return (
    (item as ProviderItem & { provider_metadata?: Record<string, unknown> }).provider_metadata ?? {}
  )
}

function asRecord(value: unknown): Record<string, unknown> {
  expect(value).toBeObject()
  return value as Record<string, unknown>
}

async function cacheFiles(): Promise<string[]> {
  try {
    return (await readdir(cacheDir)).filter((name) => name.endsWith(".json"))
  } catch {
    return []
  }
}

describe("Pixabay image search", () => {
  test("maps the complete API hit and normalized metadata", async () => {
    const harness = jsonFetch(() => ({ total: 1, totalHits: 1, hits: [IMAGE_HIT] }))
    const provider = createPixabayProvider({ fetch: harness.fetch, cacheDir })

    const items = await provider.search("winter lake", "image", 1)

    expect(items).toHaveLength(1)
    const item = items[0]
    expect(item).toMatchObject({
      provider: "pixabay",
      source_id: "10359152",
      media_type: "image",
      title: "Lake Swan Mountains Winter Nature",
      description: "lake, swan, winter nature",
      source_url: IMAGE_HIT.pageURL,
      download_url: IMAGE_HIT.imageURL,
      thumbnail_url: IMAGE_HIT.previewURL,
      width: 6000,
      height: 4000,
      creator: { name: "Lake Artist", profile_url: IMAGE_HIT.userURL },
      license: "Pixabay Content License",
      license_url: "https://pixabay.com/service/license-summary/",
      credits: { required: false, text: "Lake Artist via Pixabay" },
      api_tags: ["lake", "swan", "winter nature"],
    })
    expect(item?.raw).toEqual(IMAGE_HIT)
    expect(metadata(item)).toEqual({
      media_subtype: "photo",
      content_flags: {
        no_ai_training: true,
        is_ai_generated: false,
        is_g_rated: true,
        is_low_quality: false,
      },
      engagement: {
        views: 1000,
        downloads: 250,
        collections: 12,
        likes: 80,
        comments: 7,
      },
      contributor_avatar_url: IMAGE_HIT.userImageURL,
      original_file: { width: 6000, height: 4000, size: 8_765_432 },
      vector_url: IMAGE_HIT.vectorURL,
      selected_rendition: {
        variant: "imageURL",
        url: IMAGE_HIT.imageURL,
        width: 6000,
        height: 4000,
        size: 8_765_432,
      },
    })
  })

  test("uses raster URL priority and never downloads vectorURL", async () => {
    const variants = [
      {
        hit: { ...IMAGE_HIT, imageURL: "", vectorURL: "https://cdn.example/asset.svg" },
        expected: IMAGE_HIT.fullHDURL,
        name: "fullHDURL",
      },
      {
        hit: { ...IMAGE_HIT, imageURL: "", fullHDURL: "" },
        expected: IMAGE_HIT.largeImageURL,
        name: "largeImageURL",
      },
      {
        hit: { ...IMAGE_HIT, imageURL: "", fullHDURL: "", largeImageURL: "" },
        expected: IMAGE_HIT.webformatURL,
        name: "webformatURL",
      },
    ]
    const harness = jsonFetch((_url, call) => ({ hits: [variants[call - 1]?.hit] }))
    const provider = createPixabayProvider({ fetch: harness.fetch, cacheDir })

    for (const [index, variant] of variants.entries()) {
      const item = (await provider.search(`fallback-${index}`, "image", 1))[0]
      expect(item?.download_url).toBe(variant.expected)
      expect(asRecord(metadata(item)["selected_rendition"])["variant"]).toBe(variant.name)
      expect(item?.width).toBe(IMAGE_HIT.imageWidth)
      expect(item?.height).toBe(IMAGE_HIT.imageHeight)
      expect(item?.download_url).not.toBe(IMAGE_HIT.vectorURL)
    }
  })

  test("falls back from name to first tag and then id", async () => {
    const hits = [
      { ...IMAGE_HIT, id: 1, name: "", tags: "first tag, second" },
      { ...IMAGE_HIT, id: 2, name: "  ", tags: "" },
    ]
    const harness = jsonFetch(() => ({ hits }))
    const provider = createPixabayProvider({ fetch: harness.fetch, cacheDir })

    const items = await provider.search("titles", "image", 3)

    expect(items.map((item) => item.title)).toEqual(["first tag", "2"])
  })

  test("preserves photo, illustration, and vector API subtypes", async () => {
    const hits = (["photo", "illustration", "vector"] as const).map((type, index) => ({
      ...IMAGE_HIT,
      id: index + 1,
      name: `${type} result`,
      type,
    }))
    const harness = jsonFetch(() => ({ hits }))
    const provider = createPixabayProvider({ fetch: harness.fetch, cacheDir })

    const items = await provider.search("image subtypes", "image", 3)

    expect(items.map((item) => metadata(item)["media_subtype"])).toEqual([
      "photo",
      "illustration",
      "vector",
    ])
    expect(items.map((item) => asRecord(item.raw)["type"])).toEqual([
      "photo",
      "illustration",
      "vector",
    ])
  })

  test("skips hits without a usable raster URL or source page", async () => {
    const hits = [
      {
        ...IMAGE_HIT,
        imageURL: "",
        fullHDURL: "",
        largeImageURL: "",
        webformatURL: "",
      },
      { ...IMAGE_HIT, id: 2, pageURL: "" },
      { ...IMAGE_HIT, id: 3 },
    ]
    const harness = jsonFetch(() => ({ hits }))
    const provider = createPixabayProvider({ fetch: harness.fetch, cacheDir })

    const items = await provider.search("valid only", "image", 3)

    expect(items.map((item) => item.source_id)).toEqual(["3"])
  })
})

describe("Pixabay video search", () => {
  test("selects the widest nonempty positive-size rendition", async () => {
    const hit = {
      ...VIDEO_HIT,
      videos: {
        ...VIDEO_HIT.videos,
        hugeButEmpty: {
          url: "https://cdn.example/empty.mp4",
          width: 4000,
          height: 2000,
          size: 0,
          thumbnail: "https://cdn.example/empty.jpg",
        },
        hugeButBlank: {
          url: "  ",
          width: 5000,
          height: 2500,
          size: 99_000_000,
        },
      },
    }
    const harness = jsonFetch(() => ({ hits: [hit] }))
    const provider = createPixabayProvider({ fetch: harness.fetch, cacheDir })

    const item = (await provider.search("mountain", "video", 1))[0]

    expect(item).toMatchObject({
      media_type: "video",
      download_url: VIDEO_HIT.videos.large.url,
      thumbnail_url: VIDEO_HIT.videos.large.thumbnail,
      width: 1920,
      height: 1080,
      duration_seconds: 18,
    })
    expect(item?.raw).toEqual(hit)
    expect(asRecord(metadata(item)["selected_rendition"])).toEqual({
      variant: "large",
      ...VIDEO_HIT.videos.large,
    })
    expect(asRecord(metadata(item)["available_renditions"])).toHaveProperty("tiny")
    expect(asRecord(metadata(item)["available_renditions"])).toHaveProperty("hugeButEmpty")
  })

  test("skips a video when no rendition has a URL and positive size", async () => {
    const harness = jsonFetch(() => ({
      hits: [
        {
          ...VIDEO_HIT,
          videos: {
            large: { url: "https://cdn.example/invalid.mp4", width: 1920, size: 0 },
            small: { url: "", width: 640, size: 10 },
          },
        },
      ],
    }))
    const provider = createPixabayProvider({ fetch: harness.fetch, cacheDir })

    expect(await provider.search("invalid video", "video", 1)).toEqual([])
  })

  test("preserves film and animation API subtypes", async () => {
    const hits = (["film", "animation"] as const).map((type, index) => ({
      ...VIDEO_HIT,
      id: index + 1,
      name: `${type} result`,
      type,
    }))
    const harness = jsonFetch(() => ({ hits }))
    const provider = createPixabayProvider({ fetch: harness.fetch, cacheDir })

    const items = await provider.search("video subtypes", "video", 3)

    expect(items.map((item) => metadata(item)["media_subtype"])).toEqual(["film", "animation"])
    expect(items.map((item) => asRecord(item.raw)["type"])).toEqual(["film", "animation"])
  })
})

describe("Pixabay request behavior", () => {
  test("uses safesearch, clamps per_page, slices results, and encodes q", async () => {
    const hits = [
      IMAGE_HIT,
      { ...IMAGE_HIT, id: 2 },
      { ...IMAGE_HIT, id: 3 },
      { ...IMAGE_HIT, id: 4 },
    ]
    const harness = jsonFetch(() => ({ hits }))
    const provider = createPixabayProvider({ fetch: harness.fetch, cacheDir })

    const one = await provider.search("ice & snow", "image", 1)
    const many = await provider.search("many", "image", 500)

    expect(one).toHaveLength(1)
    expect(many).toHaveLength(4)
    const firstUrl = new URL(harness.urls[0] ?? "")
    expect(firstUrl.searchParams.get("key")).toBe("test-secret")
    expect(firstUrl.searchParams.get("q")).toBe("ice & snow")
    expect(firstUrl.searchParams.get("safesearch")).toBe("true")
    expect(firstUrl.searchParams.get("per_page")).toBe("3")
    const secondUrl = new URL(harness.urls[1] ?? "")
    expect(secondUrl.searchParams.get("per_page")).toBe("200")
  })

  test("all returns images before videos and audio makes no request", async () => {
    const harness = jsonFetch((url) => ({
      hits: [url.includes("/videos/") ? VIDEO_HIT : IMAGE_HIT],
    }))
    const provider = createPixabayProvider({ fetch: harness.fetch, cacheDir })

    const all = await provider.search("winter", "all", 1)
    const audio = await provider.search("winter", "audio", 1)

    expect(all.map((item) => item.media_type)).toEqual(["image", "video"])
    expect(harness.urls[0]).toStartWith("https://pixabay.com/api/?")
    expect(harness.urls[1]).toStartWith("https://pixabay.com/api/videos/?")
    expect(audio).toEqual([])
    expect(harness.callCount()).toBe(2)
  })

  test("rejects missing and whitespace-only keys", async () => {
    const harness = jsonFetch(() => ({ hits: [IMAGE_HIT] }))
    const provider = createPixabayProvider({ fetch: harness.fetch, cacheDir })

    delete process.env["PIXABAY_API_KEY"]
    await expect(provider.search("x", "image", 1)).rejects.toThrow(
      "PIXABAY_API_KEY required for Pixabay provider",
    )
    process.env["PIXABAY_API_KEY"] = "   "
    await expect(provider.search("x", "image", 1)).rejects.toThrow(
      "PIXABAY_API_KEY required for Pixabay provider",
    )
    expect(harness.callCount()).toBe(0)
  })

  test("rejects a query over 100 Unicode characters before fetching", async () => {
    const harness = jsonFetch(() => ({ hits: [IMAGE_HIT] }))
    const provider = createPixabayProvider({ fetch: harness.fetch, cacheDir })

    await expect(provider.search("😀".repeat(101), "image", 1)).rejects.toThrow(
      "at most 100 characters",
    )
    expect(harness.callCount()).toBe(0)
  })
})

describe("Pixabay API cache", () => {
  test("reuses a successful response and never persists the raw key or keyed URL", async () => {
    const harness = jsonFetch(() => ({ total: 1, totalHits: 1, hits: [IMAGE_HIT] }))
    const provider = createPixabayProvider({ fetch: harness.fetch, cacheDir })

    await provider.search("cached", "image", 1)
    await provider.search("cached", "image", 1)

    expect(harness.callCount()).toBe(1)
    const files = await cacheFiles()
    expect(files).toHaveLength(1)
    const filename = files[0]
    expect(filename).toBeDefined()
    const contents = await readFile(join(cacheDir, filename ?? ""), "utf8")
    expect(filename).not.toContain("test-secret")
    expect(contents).not.toContain("test-secret")
    expect(contents).not.toContain("key=")
    expect(JSON.parse(contents).response).toEqual({
      total: 1,
      totalHits: 1,
      hits: [IMAGE_HIT],
    })
  })

  test("expires entries after 24 hours", async () => {
    let clock = 1_000_000
    const harness = jsonFetch(() => ({ hits: [IMAGE_HIT] }))
    const provider = createPixabayProvider({
      fetch: harness.fetch,
      cacheDir,
      now: () => clock,
    })

    await provider.search("ttl", "image", 1)
    clock += 24 * 60 * 60 * 1000 - 1
    await provider.search("ttl", "image", 1)
    clock += 2
    await provider.search("ttl", "image", 1)

    expect(harness.callCount()).toBe(2)
  })

  test("refetches corrupt and wrong-shaped cache entries", async () => {
    const harness = jsonFetch(() => ({ hits: [IMAGE_HIT] }))
    const provider = createPixabayProvider({ fetch: harness.fetch, cacheDir })

    await provider.search("corrupt", "image", 1)
    const [filename] = await cacheFiles()
    expect(filename).toBeDefined()
    await writeFile(join(cacheDir, filename ?? ""), "not json")
    await provider.search("corrupt", "image", 1)
    await writeFile(
      join(cacheDir, filename ?? ""),
      JSON.stringify({ version: 1, cached_at_ms: Date.now(), response: { nope: [] } }),
    )
    await provider.search("corrupt", "image", 1)

    expect(harness.callCount()).toBe(3)
  })

  test("scopes cache entries by a one-way API-key fingerprint", async () => {
    const harness = jsonFetch(() => ({ hits: [IMAGE_HIT] }))
    const provider = createPixabayProvider({ fetch: harness.fetch, cacheDir })

    process.env["PIXABAY_API_KEY"] = "first-secret"
    await provider.search("key scope", "image", 1)
    process.env["PIXABAY_API_KEY"] = "second-secret"
    await provider.search("key scope", "image", 1)

    expect(harness.callCount()).toBe(2)
    const files = await cacheFiles()
    expect(files).toHaveLength(2)
    const persisted = `${files.join("\n")}\n${await Promise.all(
      files.map((filename) => readFile(join(cacheDir, filename), "utf8")),
    )}`
    expect(persisted).not.toContain("first-secret")
    expect(persisted).not.toContain("second-secret")
  })

  test("does not cache HTTP errors or invalid API shapes", async () => {
    const httpHarness = jsonFetch(() => ({ error: "bad key" }), 403)
    const httpProvider = createPixabayProvider({ fetch: httpHarness.fetch, cacheDir })
    await expect(httpProvider.search("http", "image", 1)).rejects.toThrow("Pixabay API error: 403")
    await expect(httpProvider.search("http", "image", 1)).rejects.toThrow("Pixabay API error: 403")
    expect(httpHarness.callCount()).toBe(2)

    const invalidHarness = jsonFetch(() => ({ error: "not a search response" }))
    const invalidProvider = createPixabayProvider({ fetch: invalidHarness.fetch, cacheDir })
    await expect(invalidProvider.search("invalid", "image", 1)).rejects.toThrow("invalid response")
    await expect(invalidProvider.search("invalid", "image", 1)).rejects.toThrow("invalid response")
    expect(invalidHarness.callCount()).toBe(2)
    expect(await cacheFiles()).toEqual([])
  })

  test("sanitizes network failures that contain the raw keyed URL", async () => {
    let calls = 0
    const fetcher = mock(async () => {
      calls += 1
      throw new Error("request failed for https://pixabay.com/api/?key=test-secret&q=private-query")
    }) as unknown as typeof fetch
    const provider = createPixabayProvider({ fetch: fetcher, cacheDir })

    let message = ""
    try {
      await provider.search("private-query", "image", 1)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toBe("Pixabay API request failed")
    expect(message).not.toContain("test-secret")
    expect(message).not.toContain("private-query")
    expect(calls).toBe(1)
    expect(await cacheFiles()).toEqual([])
  })
})
