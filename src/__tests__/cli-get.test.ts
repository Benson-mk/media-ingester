import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runGetCommand } from "../commands/get"
import { MediaSidecarSchema } from "../common/schema"

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

function ingesterFetch(input: string | URL | Request): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString()
  if (url.includes("upload.wikimedia.org")) {
    return Promise.resolve(new Response(FAKE_BYTES, { status: 200 }))
  }
  const body = url.includes("list=search") ? WIKI_SEARCH : WIKI_DETAIL
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}

let savedPexelsKey: string | undefined
let outDir: string

beforeEach(async () => {
  savedPexelsKey = process.env["PEXELS_API_KEY"]
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
  ;(global as { fetch?: unknown }).fetch = undefined
  process.exitCode = 0
  await rm(outDir, { recursive: true, force: true })
})

describe("runGetCommand", () => {
  test("downloads one wikimedia asset with sidecar, raw, manifest", async () => {
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
    expect(existsSync(rawPath)).toBe(true)

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
