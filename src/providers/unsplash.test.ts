import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type { ProviderItem } from "./types"
import { unsplashProvider } from "./unsplash"

const originalFetch = globalThis.fetch
const originalApiKey = process.env["UNSPLASH_ACCESS_KEY"]

const PAGE_TAG_TITLES = [
  "sunset",
  "snow",
  "lake",
  "boat",
  "peaceful",
  "volcano",
  "natural beauty",
  "beautiful sky",
  "golden hour",
  "sailboat",
  "patagonia",
  "evening",
  "serene",
  "travel destination",
  "serenity",
  "adventure travel",
  "calm water",
  "scenic view",
  "calmness",
  "tranquil",
] as const

const SEARCH_PHOTO = {
  id: "photo-1",
  width: 4000,
  height: 3000,
  description: "A detailed search description",
  alt_description: "mountain at sunset",
  urls: {
    full: "https://images.unsplash.com/photo-1?ixid=search&fm=jpg",
    small: "https://images.unsplash.com/photo-1?ixid=search&w=400",
  },
  links: {
    html: "https://unsplash.com/photos/photo-1",
    download_location: "https://api.unsplash.com/photos/photo-1/download?ixid=search",
  },
  user: {
    name: "Jane Doe",
    links: { html: "https://unsplash.com/@jane" },
  },
  tags_preview: [{ title: "Mountain" }, { title: "Sunset" }, { title: "mountain" }],
}

const DETAIL_PHOTO = {
  id: "photo-1",
  width: 6000,
  height: 4000,
  description: "The full detail description",
  alt_description: "snowy mountain at sunset",
  urls: {
    full: "https://images.unsplash.com/photo-1?ixid=detail&fm=jpg",
    small: "https://images.unsplash.com/photo-1?ixid=detail&w=400",
  },
  links: {
    html: "https://unsplash.com/photos/photo-1?foo=bar",
    download_location: "https://api.unsplash.com/photos/photo-1/download?ixid=detail",
  },
  user: {
    name: "Jane Doe",
    links: { html: "https://unsplash.com/@jane?featured=true" },
  },
  tags: PAGE_TAG_TITLES.map((title) => ({ title })),
  exif: {
    make: "Canon",
    model: " EOS M5",
    name: "Canon, EOS M5",
    exposure_time: "1/125",
    aperture: "6.3",
    focal_length: "74.0",
    iso: 640,
  },
  location: {
    name: "Osorno, Chile",
    city: "Osorno",
    country: "Chile",
    position: { latitude: -40.576401, longitude: -73.114802 },
  },
  views: 12307,
  downloads: 187,
  likes: 4,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function headersFrom(init: RequestInit | undefined): Headers {
  return new Headers(init?.headers)
}

function makeTrackingItem(overrides: Partial<ProviderItem> = {}): ProviderItem {
  return {
    provider: "unsplash",
    source_id: "photo-1",
    media_type: "image",
    title: "mountain at sunset",
    description: "A mountain",
    source_url: "https://unsplash.com/photos/photo-1?utm_source=media-ingester&utm_medium=referral",
    download_url: "https://images.unsplash.com/photo-1?ixid=detail&fm=jpg",
    creator: {
      name: "Jane Doe",
      profile_url: "https://unsplash.com/@jane?utm_source=media-ingester&utm_medium=referral",
    },
    license: "Unsplash License",
    license_url: "https://unsplash.com/license",
    credits: {
      required: true,
      text: "Photo by Jane Doe on Unsplash",
    },
    download_tracking_url: "https://api.unsplash.com/photos/photo-1/download?ixid=detail",
    api_tags: ["mountain"],
    raw: SEARCH_PHOTO,
    ...overrides,
  }
}

beforeEach(() => {
  process.env["UNSPLASH_ACCESS_KEY"] = "test-access-key"
})

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalApiKey === undefined) delete process.env["UNSPLASH_ACCESS_KEY"]
  else process.env["UNSPLASH_ACCESS_KEY"] = originalApiKey
})

describe("unsplashProvider.search", () => {
  test("authenticates photo search and maps attribution without a thumbnail URL", async () => {
    process.env["UNSPLASH_ACCESS_KEY"] = "  test-access-key  "
    let requestUrl = ""
    let requestInit: RequestInit | undefined
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      requestUrl = input.toString()
      requestInit = init
      return jsonResponse({ total_pages: 1, results: [SEARCH_PHOTO] })
    }) as unknown as typeof fetch

    const items = await unsplashProvider.search("red fox", "image", 1)

    expect(items).toHaveLength(1)
    const url = new URL(requestUrl)
    expect(url.origin + url.pathname).toBe("https://api.unsplash.com/search/photos")
    expect(url.searchParams.get("query")).toBe("red fox")
    expect(url.searchParams.get("page")).toBe("1")
    expect(url.searchParams.get("per_page")).toBe("1")
    const headers = headersFrom(requestInit)
    expect(headers.get("authorization")).toBe("Client-ID test-access-key")
    expect(headers.get("accept-version")).toBe("v1")

    const item = items[0]
    expect(item?.provider).toBe("unsplash")
    expect(item?.source_id).toBe("photo-1")
    expect(item?.media_type).toBe("image")
    expect(item?.title).toBe("mountain at sunset")
    expect(item?.description).toBe("A detailed search description")
    expect(item?.download_url).toBe("https://images.unsplash.com/photo-1?ixid=search&fm=jpg")
    expect(item?.download_tracking_url).toBe(
      "https://api.unsplash.com/photos/photo-1/download?ixid=search",
    )
    expect(item?.api_tags).toEqual(["Mountain", "Sunset"])
    expect(item?.license).toBe("Unsplash License")
    expect(item?.license_url).toBe("https://unsplash.com/license")
    expect(item?.credits?.required).toBe(true)
    expect(item?.credits?.text).toContain(
      "https://unsplash.com/?utm_source=media-ingester&utm_medium=referral",
    )
    expect(item?.credits?.text).toContain(
      "https://unsplash.com/@jane?utm_source=media-ingester&utm_medium=referral",
    )
    expect(new URL(item?.source_url ?? "").searchParams.get("utm_source")).toBe("media-ingester")
    expect(new URL(item?.creator.profile_url ?? "").searchParams.get("utm_medium")).toBe("referral")
    expect(item?.raw).toEqual(SEARCH_PHOTO)
    expect(item !== undefined && "thumbnail_url" in item).toBe(false)
  })

  test("paginates with at most 30 photos per request", async () => {
    const requestUrls: string[] = []
    const photos = Array.from({ length: 32 }, (_, index) => ({
      ...SEARCH_PHOTO,
      id: `photo-${index + 1}`,
    }))
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const url = input.toString()
      requestUrls.push(url)
      const parsed = new URL(url)
      const page = Number(parsed.searchParams.get("page"))
      const perPage = Number(parsed.searchParams.get("per_page"))
      const start = (page - 1) * perPage
      return jsonResponse({
        total_pages: Math.ceil(photos.length / perPage),
        results: photos.slice(start, start + perPage),
      })
    }) as unknown as typeof fetch

    const items = await unsplashProvider.search("mountain", "all", 32)

    expect(items).toHaveLength(32)
    expect(requestUrls).toHaveLength(2)
    expect(new URL(requestUrls[0] ?? "").searchParams.get("per_page")).toBe("30")
    expect(new URL(requestUrls[0] ?? "").searchParams.get("page")).toBe("1")
    expect(new URL(requestUrls[1] ?? "").searchParams.get("per_page")).toBe("30")
    expect(new URL(requestUrls[1] ?? "").searchParams.get("page")).toBe("2")
    expect(items.map((item) => item.source_id)).toEqual(
      Array.from({ length: 32 }, (_, index) => `photo-${index + 1}`),
    )
  })

  test("returns no results or network calls for unsupported media types", async () => {
    const fetchSpy = mock(async () => jsonResponse({ results: [SEARCH_PHOTO] }))
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    expect(await unsplashProvider.search("x", "video", 3)).toEqual([])
    expect(await unsplashProvider.search("x", "audio", 3)).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test("rejects a missing or whitespace-only access key", async () => {
    const fetchSpy = mock(async () => jsonResponse({ results: [] }))
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    process.env["UNSPLASH_ACCESS_KEY"] = "   "

    await expect(unsplashProvider.search("x", "image", 1)).rejects.toThrow(
      "UNSPLASH_ACCESS_KEY required for Unsplash provider",
    )
    delete process.env["UNSPLASH_ACCESS_KEY"]
    await expect(unsplashProvider.search("x", "image", 1)).rejects.toThrow(
      "UNSPLASH_ACCESS_KEY required for Unsplash provider",
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test("throws an error containing the HTTP status", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({ errors: ["Rate Limit Exceeded"] }, 429),
    ) as unknown as typeof fetch

    await expect(unsplashProvider.search("x", "image", 1)).rejects.toThrow(
      "Unsplash API error: 429",
    )
  })
})

describe("unsplashProvider.getDetails", () => {
  test("hydrates tags, EXIF, location, URLs, and preserves search/detail raw metadata", async () => {
    let call = 0
    const requestUrls: string[] = []
    const requestInits: Array<RequestInit | undefined> = []
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      requestUrls.push(input.toString())
      requestInits.push(init)
      call += 1
      return call === 1
        ? jsonResponse({ total_pages: 1, results: [SEARCH_PHOTO] })
        : jsonResponse(DETAIL_PHOTO)
    }) as unknown as typeof fetch

    const [summary] = await unsplashProvider.search("mountain", "image", 1)
    expect(summary).toBeDefined()
    if (!summary) throw new Error("expected Unsplash summary fixture")
    const hydrated = await unsplashProvider.getDetails(summary)

    expect(new URL(requestUrls[1] ?? "").pathname).toBe("/photos/photo-1")
    expect(hydrated.title).toBe("snowy mountain at sunset")
    expect(hydrated.description).toBe("The full detail description")
    expect(hydrated.width).toBe(6000)
    expect(hydrated.height).toBe(4000)
    expect(hydrated.download_url).toBe("https://images.unsplash.com/photo-1?ixid=detail&fm=jpg")
    expect(hydrated.download_tracking_url).toBe(
      "https://api.unsplash.com/photos/photo-1/download?ixid=detail",
    )
    expect(hydrated.api_tags).toEqual([...PAGE_TAG_TITLES])
    expect(hydrated.api_tags).toHaveLength(20)
    expect(hydrated.exif).toEqual({
      Make: "Canon",
      Model: "EOS M5",
      ExposureTime: "1/125",
      FNumber: 6.3,
      FocalLength: 74,
      ISO: 640,
    })
    expect(hydrated.location).toBe("Osorno, Chile")
    expect(hydrated.raw).toEqual({ search: SEARCH_PHOTO, detail: DETAIL_PHOTO })
    const rawDetail = (hydrated.raw as { detail: typeof DETAIL_PHOTO }).detail
    expect(rawDetail.location.position).toEqual({
      latitude: -40.576401,
      longitude: -73.114802,
    })
    expect({
      views: rawDetail.views,
      downloads: rawDetail.downloads,
      likes: rawDetail.likes,
    }).toEqual({ views: 12307, downloads: 187, likes: 4 })
    expect("thumbnail_url" in hydrated).toBe(false)
    expect(new URL(hydrated.source_url).searchParams.get("foo")).toBe("bar")
    expect(new URL(hydrated.source_url).searchParams.get("utm_source")).toBe("media-ingester")
    expect(new URL(hydrated.creator.profile_url).searchParams.get("featured")).toBe("true")
    const detailHeaders = headersFrom(requestInits[1])
    expect(detailHeaders.get("authorization")).toBe("Client-ID test-access-key")
    expect(detailHeaders.get("accept-version")).toBe("v1")
  })

  test("omits null camera/location fields while retaining them in raw detail", async () => {
    const detailWithNulls = {
      ...DETAIL_PHOTO,
      description: null,
      alt_description: null,
      exif: {
        make: null,
        model: null,
        name: null,
        exposure_time: null,
        aperture: null,
        focal_length: null,
        iso: null,
      },
      location: {
        name: null,
        city: null,
        country: null,
        position: { latitude: 0, longitude: 0 },
      },
    }
    globalThis.fetch = mock(async () => jsonResponse(detailWithNulls)) as unknown as typeof fetch

    const hydrated = await unsplashProvider.getDetails(makeTrackingItem())

    expect(hydrated.exif).toBeUndefined()
    expect(hydrated.location).toBeUndefined()
    expect(hydrated.title).toBe("mountain at sunset")
    expect(hydrated.raw).toEqual({ search: SEARCH_PHOTO, detail: detailWithNulls })
  })

  test("rejects mismatched or incomplete detail responses", async () => {
    for (const detail of [
      { ...DETAIL_PHOTO, id: "different-photo" },
      { ...DETAIL_PHOTO, urls: {} },
      { ...DETAIL_PHOTO, links: { html: DETAIL_PHOTO.links.html } },
    ]) {
      globalThis.fetch = mock(async () => jsonResponse(detail)) as unknown as typeof fetch
      await expect(unsplashProvider.getDetails(makeTrackingItem())).rejects.toThrow(
        /Unsplash detail response/,
      )
    }
  })
})

describe("unsplashProvider.trackDownload", () => {
  test("authorizes the exact tracking URL and preserves its query", async () => {
    let requestUrl = ""
    let requestInit: RequestInit | undefined
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      requestUrl = input.toString()
      requestInit = init
      return new Response(null, { status: 204 })
    }) as unknown as typeof fetch

    await unsplashProvider.trackDownload(makeTrackingItem())

    expect(requestUrl).toBe("https://api.unsplash.com/photos/photo-1/download?ixid=detail")
    const headers = headersFrom(requestInit)
    expect(headers.get("authorization")).toBe("Client-ID test-access-key")
    expect(headers.get("accept-version")).toBe("v1")
    expect(requestInit?.redirect).toBe("error")
  })

  test("rejects missing or untrusted tracking URLs without a network call", async () => {
    const fetchSpy = mock(async () => new Response(null, { status: 204 }))
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    const missingTrackingItem = makeTrackingItem()
    delete missingTrackingItem.download_tracking_url

    await expect(unsplashProvider.trackDownload(missingTrackingItem)).rejects.toThrow(
      "Unsplash download tracking URL required",
    )
    await expect(
      unsplashProvider.trackDownload(
        makeTrackingItem({
          download_tracking_url: "https://attacker.example/photos/photo-1/download",
        }),
      ),
    ).rejects.toThrow("Invalid Unsplash download tracking URL")
    await expect(
      unsplashProvider.trackDownload(
        makeTrackingItem({
          download_tracking_url: "https://api.unsplash.com/photos/other-photo/download",
        }),
      ),
    ).rejects.toThrow("Invalid Unsplash download tracking URL")
    await expect(
      unsplashProvider.trackDownload(
        makeTrackingItem({
          download_tracking_url:
            "https://user:password@api.unsplash.com/photos/photo-1/download#fragment",
        }),
      ),
    ).rejects.toThrow("Invalid Unsplash download tracking URL")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test("throws when the tracking endpoint is not successful", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({ errors: ["Forbidden"] }, 403),
    ) as unknown as typeof fetch

    await expect(unsplashProvider.trackDownload(makeTrackingItem())).rejects.toThrow(
      "Unsplash download tracking error: 403",
    )
  })
})
