import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { pexelsProvider, resetPexelsRateLimit } from "./pexels"

const PHOTO_FIXTURE = {
  photos: [
    {
      id: 12345,
      width: 4000,
      height: 3000,
      url: "https://www.pexels.com/photo/12345/",
      alt: "A mountain at sunset",
      photographer: "Jane Doe",
      photographer_url: "https://www.pexels.com/@jane",
      src: {
        original: "https://images.pexels.com/photos/12345/original.jpg",
        medium: "https://images.pexels.com/photos/12345/medium.jpg",
      },
    },
  ],
}

const VIDEO_FIXTURE = {
  videos: [
    {
      id: 67890,
      width: 2560,
      height: 1440,
      url: "https://www.pexels.com/video/67890/",
      image: "https://images.pexels.com/videos/67890/thumb.jpg",
      duration: 30,
      user: { name: "John Smith", url: "https://www.pexels.com/@john" },
      video_files: [
        {
          quality: "hd",
          file_type: "video/mp4",
          width: 1920,
          height: 1080,
          fps: 30,
          link: "https://player.vimeo.com/1920.mp4",
        },
        {
          quality: "hd",
          file_type: "video/mp4",
          width: 2560,
          height: 1440,
          fps: 30,
          link: "https://player.vimeo.com/2560.mp4",
        },
      ],
    },
  ],
}

function mockFetch(fixture: unknown, status = 200): void {
  global.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify(fixture), { status })),
  ) as unknown as typeof fetch
}

beforeEach(() => {
  resetPexelsRateLimit()
  Object.assign(process.env, { PEXELS_API_KEY: "test-key" })
})

afterEach(() => {
  ;(global.fetch as unknown) = undefined
  resetPexelsRateLimit()
})

test("photo search maps alt to title and src.original to download_url", async () => {
  mockFetch(PHOTO_FIXTURE)
  const items = await pexelsProvider.search("mountain", "image", 1)
  expect(items).toHaveLength(1)
  const item = items[0]
  expect(item?.title).toBe("A mountain at sunset")
  expect(item?.download_url).toBe("https://images.pexels.com/photos/12345/original.jpg")
  expect(item?.thumbnail_url).toBe("https://images.pexels.com/photos/12345/medium.jpg")
  expect(item?.creator).toEqual({
    name: "Jane Doe",
    profile_url: "https://www.pexels.com/@jane",
  })
  expect(item?.license).toBe("pexels")
  expect(item?.api_tags).toEqual([])
})

test("video search picks 2560-width file over 1920-width file", async () => {
  mockFetch(VIDEO_FIXTURE)
  const items = await pexelsProvider.search("nature", "video", 1)
  expect(items).toHaveLength(1)
  const item = items[0]
  expect(item?.download_url).toBe("https://player.vimeo.com/2560.mp4")
  expect(item?.duration_seconds).toBe(30)
  expect(item?.creator.name).toBe("John Smith")
})

test("missing PEXELS_API_KEY throws", async () => {
  mockFetch(PHOTO_FIXTURE)
  Object.assign(process.env, { PEXELS_API_KEY: "" })
  await expect(pexelsProvider.search("x", "image", 1)).rejects.toThrow(
    "PEXELS_API_KEY required for Pexels provider",
  )
})

test("rate limiting enforces >=500ms between consecutive calls", async () => {
  mockFetch(PHOTO_FIXTURE)
  const start = performance.now()
  await pexelsProvider.search("a", "image", 1)
  await pexelsProvider.search("b", "image", 1)
  const elapsed = performance.now() - start
  expect(elapsed).toBeGreaterThanOrEqual(490)
})

test("HTTP 429 throws error mentioning status", async () => {
  mockFetch({ error: "rate limited" }, 429)
  await expect(pexelsProvider.search("x", "image", 1)).rejects.toThrow("Pexels API error: 429")
})
