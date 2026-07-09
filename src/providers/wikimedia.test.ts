import { afterEach, describe, expect, mock, test } from "bun:test"
import { wikimediaProvider } from "./wikimedia"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

type Json = Record<string, unknown>

function jsonResponse(body: Json, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response
}

function searchBody(titles: string[]): Json {
  return { query: { search: titles.map((title) => ({ title })) } }
}

function detailBody(page: Json): Json {
  return { query: { pages: { "-1": page } } }
}

/** Mock fetch: first call = search, subsequent calls = details in order. */
function mockFetch(search: Json, details: Json[]): void {
  let call = 0
  globalThis.fetch = mock(async () => {
    const idx = call++
    if (idx === 0) return jsonResponse(search)
    const body = details[idx - 1]
    if (!body) throw new Error("unexpected extra fetch call")
    return jsonResponse(body)
  }) as unknown as typeof fetch
}

describe("wikimediaProvider.search", () => {
  test("happy path maps a ProviderItem", async () => {
    mockFetch(searchBody(["File:Bridge.jpg"]), [
      detailBody({
        title: "File:Bridge.jpg",
        imageinfo: [
          {
            url: "https://upload.wikimedia.org/bridge.jpg",
            mime: "image/jpeg",
            width: 800,
            height: 600,
            extmetadata: {
              Artist: { value: "<a href='x'>John Doe</a>" },
              ImageDescription: { value: "<p>A bridge</p>" },
              LicenseShortName: { value: "CC BY-SA 4.0" },
            },
          },
        ],
      }),
    ])

    const items = await wikimediaProvider.search("bridge", "all", 1)
    expect(items).toHaveLength(1)
    const item = items[0]
    expect(item).toBeDefined()
    expect(item?.provider).toBe("wikimedia")
    expect(item?.source_id).toBe("File:Bridge.jpg")
    expect(item?.title).toBe("Bridge")
    expect(item?.media_type).toBe("image")
    expect(item?.download_url).toBe("https://upload.wikimedia.org/bridge.jpg")
    expect(item?.creator.name).toBe("John Doe")
    expect(item?.description).toBe("A bridge")
    expect(item?.license).toBe("CC BY-SA 4.0")
    expect(item?.source_url).toBe("https://commons.wikimedia.org/wiki/File:Bridge.jpg")
    expect(item?.width).toBe(800)
    expect(item?.height).toBe(600)
  })

  test("missing extmetadata falls back to unknown/empty", async () => {
    mockFetch(searchBody(["File:Test.jpg"]), [
      detailBody({
        title: "File:Test.jpg",
        imageinfo: [{ url: "https://example.com/test.jpg", mime: "image/jpeg", extmetadata: {} }],
      }),
    ])

    const items = await wikimediaProvider.search("test", "all", 1)
    const item = items[0]
    expect(item?.license).toBe("unknown")
    expect(item?.description).toBe("")
    expect(item?.creator.name).toBe("Unknown")
  })

  test("audio mime maps to audio media_type", async () => {
    mockFetch(searchBody(["File:Song.mp3"]), [
      detailBody({
        title: "File:Song.mp3",
        imageinfo: [{ url: "https://example.com/song.mp3", mime: "audio/mpeg", extmetadata: {} }],
      }),
    ])

    const items = await wikimediaProvider.search("song", "all", 1)
    expect(items[0]?.media_type).toBe("audio")
  })

  test("non-200 search throws mentioning Wikimedia", async () => {
    globalThis.fetch = mock(async () => jsonResponse({}, false, 500)) as unknown as typeof fetch
    await expect(wikimediaProvider.search("x", "all", 1)).rejects.toThrow(/Wikimedia/)
  })

  test("type=image filter removes video items", async () => {
    mockFetch(searchBody(["File:Clip.webm", "File:Photo.jpg"]), [
      detailBody({
        title: "File:Clip.webm",
        imageinfo: [{ url: "https://example.com/clip.webm", mime: "video/webm", extmetadata: {} }],
      }),
      detailBody({
        title: "File:Photo.jpg",
        imageinfo: [{ url: "https://example.com/photo.jpg", mime: "image/jpeg", extmetadata: {} }],
      }),
    ])

    const items = await wikimediaProvider.search("clip", "image", 2)
    expect(items).toHaveLength(1)
    expect(items[0]?.media_type).toBe("image")
    expect(items[0]?.source_id).toBe("File:Photo.jpg")
  })
})
