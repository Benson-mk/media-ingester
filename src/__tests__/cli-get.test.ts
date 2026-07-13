import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runGetCommand } from "../commands/get"
import { MediaSidecarSchema } from "../common/schema"
import type { Provider, ProviderItem } from "../providers/types"

const WIKI_SEARCH = {
  query: { search: [{ title: "File:Test image.jpg" }] },
}

const WIKI_DETAIL = {
  query: {
    pages: {
      "-1": {
        title: "File:Test image.jpg",
        imageinfo: [
          {
            url: "https://upload.wikimedia.org/test.jpg",
            mime: "image/jpeg",
            width: 800,
            height: 600,
            extmetadata: {
              LicenseShortName: { value: "CC BY-SA 4.0" },
              Artist: { value: "Jane Doe" },
              ImageDescription: { value: "A test image" },
            },
          },
        ],
      },
    },
  },
}

const FAKE_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

const PIXABAY_BOOTSTRAP = {
  id: 10359152,
  name: "Swan on a winter lake",
  description: "A swan crossing an alpine lake in winter.",
  cameraName: "Sony Ilce-7rm3",
  flash: false,
  isEditorsChoice: true,
  viewCount: 999,
  attributionHtml: "Photo by <strong>RosZie</strong> on Pixabay",
}

function pixabayItem(): ProviderItem {
  return {
    provider: "pixabay",
    source_id: "10359152",
    media_type: "image",
    title: "lake",
    description: "lake, swan, winter",
    source_url: "https://pixabay.com/photos/lake-swan-mountains-winter-nature-10359152/",
    download_url: "https://cdn.pixabay.test/10359152.jpg",
    width: 7073,
    height: 4715,
    creator: { name: "RosZie", profile_url: "https://pixabay.com/users/roszie-55/" },
    license: "Pixabay Content License",
    license_url: "https://pixabay.com/service/license-summary/",
    credits: { required: false, text: "RosZie via Pixabay" },
    api_tags: ["lake", "swan", "winter"],
    raw: { id: 10359152, views: 120 },
    provider_metadata: { engagement: { views: 120 } },
  }
}

function onlyProvider(provider: Provider): () => { ok: true; providers: Provider[] } {
  return () => ({ ok: true, providers: [provider] })
}

const UNSPLASH_SEARCH = {
  total_pages: 1,
  results: [
    {
      id: "photo-1",
      width: 4000,
      height: 3000,
      description: "Detailed search description",
      alt_description: "mountain at sunset",
      urls: { full: "https://images.unsplash.com/photo-1?ixid=search&fm=jpg" },
      links: {
        html: "https://unsplash.com/photos/photo-1",
        download_location: "https://api.unsplash.com/photos/photo-1/download?ixid=search",
      },
      user: { name: "Jane Doe", links: { html: "https://unsplash.com/@jane" } },
      tags_preview: [{ title: "mountain" }],
    },
  ],
}

const UNSPLASH_DETAIL = {
  id: "photo-1",
  width: 4000,
  height: 3000,
  description: "Full detail description",
  alt_description: "mountain at sunset",
  urls: { full: "https://images.unsplash.com/photo-1?ixid=detail&fm=jpg" },
  links: {
    html: "https://unsplash.com/photos/photo-1",
    download_location: "https://api.unsplash.com/photos/photo-1/download?ixid=detail",
  },
  user: { name: "Jane Doe", links: { html: "https://unsplash.com/@jane" } },
  tags: [{ title: "mountain" }, { title: "sunset" }],
  exif: {
    make: "Canon",
    model: "EOS R5",
    exposure_time: "1/250",
    aperture: "2.8",
    focal_length: "50.0",
    iso: 100,
  },
  location: { name: "Swiss Alps" },
}

type UnsplashFailure = "detail" | "track" | "cdn" | undefined

function unsplashFetch(
  calls: string[],
  failure?: UnsplashFailure,
): (input: string | URL | Request) => Promise<Response> {
  return async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString()
    calls.push(url)

    if (url.startsWith("https://api.unsplash.com/search/photos?")) {
      return new Response(JSON.stringify(UNSPLASH_SEARCH), { status: 200 })
    }
    if (url === "https://api.unsplash.com/photos/photo-1") {
      return failure === "detail"
        ? new Response(JSON.stringify({ errors: ["detail failed"] }), { status: 503 })
        : new Response(JSON.stringify(UNSPLASH_DETAIL), { status: 200 })
    }
    if (url === "https://api.unsplash.com/photos/photo-1/download?ixid=detail") {
      return failure === "track"
        ? new Response(null, { status: 503 })
        : new Response(null, { status: 200 })
    }
    if (url === "https://images.unsplash.com/photo-1?ixid=detail&fm=jpg") {
      return failure === "cdn"
        ? new Response(null, { status: 503 })
        : new Response(FAKE_BYTES, { status: 200 })
    }
    throw new Error(`unexpected URL: ${url}`)
  }
}

function classifyUnsplashCalls(calls: readonly string[]): string[] {
  return calls.map((url) => {
    if (url.includes("/search/photos?")) return "search"
    if (url.includes("/photos/photo-1/download?")) return "track"
    if (url === "https://api.unsplash.com/photos/photo-1") return "detail"
    if (url.startsWith("https://images.unsplash.com/")) return "cdn"
    return url
  })
}

function ingesterFetch(input: string | URL | Request): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString()
  if (url.includes("upload.wikimedia.org")) {
    return Promise.resolve(new Response(FAKE_BYTES, { status: 200 }))
  }
  const body = url.includes("list=search") ? WIKI_SEARCH : WIKI_DETAIL
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}

let savedPexelsKey: string | undefined
let savedUnsplashKey: string | undefined
let outDir: string

beforeEach(async () => {
  savedPexelsKey = process.env["PEXELS_API_KEY"]
  savedUnsplashKey = process.env["UNSPLASH_ACCESS_KEY"]
  process.exitCode = 0
  outDir = await mkdtemp(join(tmpdir(), "mi-get-"))
  global.fetch = mock(ingesterFetch) as unknown as typeof fetch
})

afterEach(async () => {
  if (savedPexelsKey === undefined) {
    delete process.env["PEXELS_API_KEY"]
  } else {
    process.env["PEXELS_API_KEY"] = savedPexelsKey
  }
  if (savedUnsplashKey === undefined) {
    delete process.env["UNSPLASH_ACCESS_KEY"]
  } else {
    process.env["UNSPLASH_ACCESS_KEY"] = savedUnsplashKey
  }
  ;(global as { fetch?: unknown }).fetch = undefined
  process.exitCode = 0
  await rm(outDir, { recursive: true, force: true })
})

describe("runGetCommand", () => {
  test("Pixabay get preserves API and website metadata in one sidecar", async () => {
    const item = pixabayItem()
    const provider: Provider = {
      id: "pixabay",
      supported: ["image", "video"],
      search: mock(async () => [item]),
    }
    const enrichment = mock(async () => PIXABAY_BOOTSTRAP)
    const assetFetch = mock(async () => new Response(FAKE_BYTES, { status: 200 }))
    global.fetch = assetFetch as unknown as typeof fetch

    await runGetCommand(
      "winter lake",
      { provider: "pixabay", limit: "1", downloadTop: "1", out: outDir },
      {
        resolveProviders: onlyProvider(provider),
        fetchPixabayBootstrap: enrichment,
      },
    )

    expect(enrichment).toHaveBeenCalledTimes(1)
    expect(enrichment).toHaveBeenCalledWith(item.source_url, item.source_id)
    expect(assetFetch).toHaveBeenCalledTimes(1)

    const files = await readdir(outDir)
    const sidecarFile = files.find((file) => file.endsWith(".media.json"))
    const rawFile = files.find((file) => file.endsWith(".external.raw.json"))
    if (sidecarFile === undefined) throw new Error("missing sidecar")
    expect(rawFile).toBeUndefined()
    expect(files.filter((file) => file.endsWith(".json"))).toEqual([sidecarFile])

    const sidecar = MediaSidecarSchema.parse(
      JSON.parse(await readFile(join(outDir, sidecarFile), "utf8")),
    )
    expect(sidecar.summary.title).toBe("Swan on a winter lake")
    expect(sidecar.source?.exif?.["Flash"]).toBe(false)
    expect(sidecar.source?.raw?.api).toEqual(item.raw)
    expect(sidecar.source?.raw?.bootstrap).toEqual(PIXABAY_BOOTSTRAP)
    expect(sidecar.source?.provider_metadata?.["engagement"]).toEqual({ views: 120 })
    expect(sidecar.source?.raw_metadata_path).toBeUndefined()

    const skippedEnrichment = mock(async () => PIXABAY_BOOTSTRAP)
    assetFetch.mockClear()
    await runGetCommand(
      "winter lake",
      { provider: "pixabay", limit: "1", downloadTop: "1", out: outDir },
      {
        resolveProviders: onlyProvider(provider),
        fetchPixabayBootstrap: skippedEnrichment,
      },
    )
    expect(skippedEnrichment).not.toHaveBeenCalled()
    expect(assetFetch).not.toHaveBeenCalled()
  })

  test("Pixabay dry-run searches but never crawls, downloads, or writes outputs", async () => {
    const search = mock(async () => [pixabayItem()])
    const provider: Provider = { id: "pixabay", supported: ["image", "video"], search }
    const enrichment = mock(async () => PIXABAY_BOOTSTRAP)
    const assetFetch = mock(async () => new Response(FAKE_BYTES, { status: 200 }))
    global.fetch = assetFetch as unknown as typeof fetch

    await runGetCommand(
      "winter lake",
      {
        provider: "pixabay",
        limit: "1",
        downloadTop: "1",
        out: outDir,
        dryRun: true,
      },
      {
        resolveProviders: onlyProvider(provider),
        fetchPixabayBootstrap: enrichment,
      },
    )

    expect(search).toHaveBeenCalledTimes(1)
    expect(enrichment).not.toHaveBeenCalled()
    expect(assetFetch).not.toHaveBeenCalled()
    expect(await readdir(outDir)).toEqual([])
  })

  test("Pixabay missing website metadata falls back to API metadata and still downloads", async () => {
    const item = pixabayItem()
    const provider: Provider = {
      id: "pixabay",
      supported: ["image", "video"],
      search: async () => [item],
    }
    global.fetch = mock(
      async () => new Response(FAKE_BYTES, { status: 200 }),
    ) as unknown as typeof fetch

    await runGetCommand(
      "winter lake",
      { provider: "pixabay", limit: "1", downloadTop: "1", out: outDir },
      {
        resolveProviders: onlyProvider(provider),
        fetchPixabayBootstrap: async () => null,
      },
    )

    const sidecarFile = (await readdir(outDir)).find((file) => file.endsWith(".media.json"))
    if (sidecarFile === undefined) throw new Error("missing sidecar")
    const sidecar = MediaSidecarSchema.parse(
      JSON.parse(await readFile(join(outDir, sidecarFile), "utf8")),
    )
    expect(sidecar.summary.title).toBe("lake")
    expect(sidecar.source?.raw?.api).toEqual(item.raw)
    expect(sidecar.source?.raw?.bootstrap).toBeUndefined()
    expect(sidecar.source?.provider_metadata?.["engagement"]).toEqual({ views: 120 })
  })

  test("downloads one wikimedia asset with one metadata sidecar and manifest", async () => {
    await runGetCommand("test", {
      provider: "wikimedia",
      limit: "1",
      downloadTop: "1",
      out: outDir,
    })

    const assetPath = join(outDir, "wikimedia-File:Test image.jpg-test-image.jpg")
    expect(existsSync(assetPath)).toBe(true)

    const sidecarPath = join(outDir, "wikimedia-File:Test image.jpg-test-image.media.json")
    expect(existsSync(sidecarPath)).toBe(true)
    const sidecarJson: unknown = JSON.parse(await readFile(sidecarPath, "utf8"))
    const parsed = MediaSidecarSchema.safeParse(sidecarJson)
    expect(parsed.success).toBe(true)
    expect(parsed.data?.source?.provider).toBe("wikimedia")
    const rawPath = join(outDir, "wikimedia-File:Test image.jpg-test-image.external.raw.json")
    expect(existsSync(rawPath)).toBe(false)
    expect(parsed.data?.source?.raw_metadata_path).toBeUndefined()
    expect(parsed.data?.source?.raw?.api).toBeDefined()
    expect(parsed.data?.source?.raw?.json_ld).toBeNull()

    const manifestPath = join(outDir, "media_manifest.jsonl")
    expect(existsSync(manifestPath)).toBe(true)
    const manifest = (await readFile(manifestPath, "utf8")).trim().split("\n")
    expect(manifest.length).toBe(1)
  })

  test("re-run is idempotent (manifest stays single line)", async () => {
    const opts = { provider: "wikimedia", limit: "1", downloadTop: "1", out: outDir }
    await runGetCommand("test", opts)
    await runGetCommand("test", opts)

    const manifest = (await readFile(join(outDir, "media_manifest.jsonl"), "utf8"))
      .trim()
      .split("\n")
    expect(manifest.length).toBe(1)
  })

  test("Unsplash without a thumbnail hydrates, tracks, then fetches the detailed CDN URL", async () => {
    process.env["UNSPLASH_ACCESS_KEY"] = "test-unsplash-key"
    const calls: string[] = []
    global.fetch = mock(unsplashFetch(calls)) as unknown as typeof fetch

    await runGetCommand("mountain", {
      provider: "unsplash",
      limit: "1",
      downloadTop: "1",
      out: outDir,
    })

    expect(classifyUnsplashCalls(calls)).toEqual(["search", "detail", "track", "cdn"])
    const files = await readdir(outDir)
    const assetFile = files.find((file) => file.endsWith(".jpg"))
    const sidecarFile = files.find((file) => file.endsWith(".media.json"))
    const rawFile = files.find((file) => file.endsWith(".external.raw.json"))
    expect(assetFile).toBeDefined()
    expect(sidecarFile).toBeDefined()
    expect(rawFile).toBeUndefined()
    if (assetFile === undefined || sidecarFile === undefined) {
      throw new Error("missing output files")
    }

    const sidecar = MediaSidecarSchema.parse(
      JSON.parse(await readFile(join(outDir, sidecarFile), "utf8")),
    )
    expect(sidecar.source?.download_url).toBe(
      "https://images.unsplash.com/photo-1?ixid=detail&fm=jpg",
    )
    expect(sidecar.source?.credits).toEqual({
      required: true,
      text: "Photo by Jane Doe (https://unsplash.com/@jane?utm_source=media-ingester&utm_medium=referral) on Unsplash (https://unsplash.com/?utm_source=media-ingester&utm_medium=referral)",
    })
    expect(sidecar.source?.exif).toEqual({
      Make: "Canon",
      Model: "EOS R5",
      ExposureTime: "1/250",
      FNumber: 2.8,
      FocalLength: 50,
      ISO: 100,
    })
    expect(sidecar.source?.location).toBe("Swiss Alps")
    expect(sidecar.source_file).toBe(join(outDir, assetFile))
    expect(sidecar.technical).toEqual({
      width: 4000,
      height: 3000,
      orientation: null,
      aspect_ratio: "4:3",
    })
    expect(sidecar.tags.core).toEqual(["mountain", "sunset"])
    expect(sidecar.summary.short_caption).toBe("Full detail description")
    expect(sidecar.source?.raw_metadata_path).toBeUndefined()
    expect(
      (sidecar.source?.raw?.api as { detail?: { description?: string } } | undefined)?.detail
        ?.description,
    ).toBe("Full detail description")
    expect((sidecar.source?.raw?.api as { search?: unknown } | undefined)?.search).toEqual(
      UNSPLASH_SEARCH.results[0],
    )
    expect(sidecar.source?.raw?.json_ld).toBeNull()
  })

  test("Unsplash dry-run does not hydrate, track, or download", async () => {
    process.env["UNSPLASH_ACCESS_KEY"] = "test-unsplash-key"
    const calls: string[] = []
    global.fetch = mock(unsplashFetch(calls)) as unknown as typeof fetch

    await runGetCommand("mountain", {
      provider: "unsplash",
      limit: "1",
      downloadTop: "1",
      out: outDir,
      dryRun: true,
    })

    expect(classifyUnsplashCalls(calls)).toEqual(["search"])
    expect(await readdir(outDir)).toEqual([])
  })

  test("Unsplash idempotent skip does not hydrate, track, download, or rewrite metadata", async () => {
    process.env["UNSPLASH_ACCESS_KEY"] = "test-unsplash-key"
    const calls: string[] = []
    global.fetch = mock(unsplashFetch(calls)) as unknown as typeof fetch
    const options = {
      provider: "unsplash",
      limit: "1",
      downloadTop: "1",
      out: outDir,
    }

    await runGetCommand("mountain", options)
    const files = await readdir(outDir)
    const metadataFiles = files.filter(
      (file) => file.endsWith(".media.json") || file === "media_manifest.jsonl",
    )
    const before = new Map(
      await Promise.all(
        metadataFiles.map(
          async (file) => [file, await readFile(join(outDir, file), "utf8")] as const,
        ),
      ),
    )

    calls.length = 0
    await runGetCommand("mountain", options)

    expect(classifyUnsplashCalls(calls)).toEqual(["search"])
    for (const [file, contents] of before) {
      expect(await readFile(join(outDir, file), "utf8")).toBe(contents)
    }
  })

  test("Unsplash force downloads hydrate and track again", async () => {
    process.env["UNSPLASH_ACCESS_KEY"] = "test-unsplash-key"
    const calls: string[] = []
    global.fetch = mock(unsplashFetch(calls)) as unknown as typeof fetch
    const options = {
      provider: "unsplash",
      limit: "1",
      downloadTop: "1",
      out: outDir,
    }

    await runGetCommand("mountain", options)
    calls.length = 0
    await runGetCommand("mountain", { ...options, force: true })

    expect(classifyUnsplashCalls(calls)).toEqual(["search", "detail", "track", "cdn"])
  })

  for (const failure of ["detail", "track", "cdn"] as const) {
    test(`Unsplash ${failure} failure blocks asset and metadata writes`, async () => {
      process.env["UNSPLASH_ACCESS_KEY"] = "test-unsplash-key"
      const calls: string[] = []
      global.fetch = mock(unsplashFetch(calls, failure)) as unknown as typeof fetch

      await expect(
        runGetCommand("mountain", {
          provider: "unsplash",
          limit: "1",
          downloadTop: "1",
          out: outDir,
        }),
      ).rejects.toThrow()

      expect(await readdir(outDir)).toEqual([])
      const expectedCalls = ["search", "detail"]
      if (failure !== "detail") expectedCalls.push("track")
      if (failure === "cdn") expectedCalls.push("cdn")
      expect(classifyUnsplashCalls(calls)).toEqual(expectedCalls)
    })
  }

  test("dry-run writes nothing and prints plan", async () => {
    const bunWriteSpy = mock(Bun.write)
    const originalWrite = Bun.write
    ;(Bun as { write: unknown }).write = bunWriteSpy
    const logs: string[] = []
    const logSpy = mock((...args: unknown[]) => {
      logs.push(args.map(String).join(" "))
    })
    const originalLog = console.log
    console.log = logSpy as unknown as typeof console.log

    try {
      await runGetCommand("test", {
        provider: "wikimedia",
        limit: "1",
        downloadTop: "1",
        out: outDir,
        dryRun: true,
      })
    } finally {
      console.log = originalLog
      ;(Bun as { write: unknown }).write = originalWrite
    }

    expect(bunWriteSpy).not.toHaveBeenCalled()
    expect(existsSync(join(outDir, "media_manifest.jsonl"))).toBe(false)
    expect(logs.join("\n")).toContain("[image]")
  })

  test("pexels with no key exits 1", async () => {
    delete process.env["PEXELS_API_KEY"]
    const errSpy = mock(() => {})
    const original = console.error
    console.error = errSpy as unknown as typeof console.error

    try {
      await runGetCommand("test", { provider: "pexels", out: outDir })
    } finally {
      console.error = original
    }

    expect(process.exitCode).toBe(1)
    expect(existsSync(join(outDir, "media_manifest.jsonl"))).toBe(false)
  })
})
