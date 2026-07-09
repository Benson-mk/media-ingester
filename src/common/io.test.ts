import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { hashFile } from "./hashFile"
import { logger } from "./logger"
import { sidecarPath } from "./paths"
import { writeSidecar } from "./writeJson"
import { appendManifestLine, updateManifestLine } from "./writeJsonl"

async function makeTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "media-tagger-"))
}

function parseJsonLine(line: string): unknown {
  return JSON.parse(line)
}

afterEach(async () => {
  await Bun.sleep(0)
})

test("sidecarPath returns media sidecar when given media file", () => {
  expect(sidecarPath("foo/bar.jpg")).toBe("foo/bar.media.json")
})

test("sidecarPath returns same path when already sidecar", () => {
  expect(sidecarPath("foo/bar.media.json")).toBe("foo/bar.media.json")
})

test("sidecarPath throws clear error when given empty path", () => {
  expect(() => sidecarPath("")).toThrow("media path cannot be empty")
})

test("hashFile returns sha256 hex when given package json", async () => {
  const hash = await hashFile("package.json")

  expect(hash).toMatch(/^[0-9a-f]{64}$/)
})

test("writeSidecar writes pretty json into sidecar file", async () => {
  const tempDir = await makeTempDir()
  const mediaPath = join(tempDir, "photo.jpg")
  await writeFile(mediaPath, "")

  await writeSidecar(mediaPath, { alpha: 1, nested: { beta: true } })

  const contents = await readFile(join(tempDir, "photo.media.json"), "utf8")

  expect(contents).toBe('{\n  "alpha": 1,\n  "nested": {\n    "beta": true\n  }\n}\n')
})

test("appendManifestLine and updateManifestLine rewrite matching manifest line", async () => {
  const tempDir = await makeTempDir()
  const manifestPath = join(tempDir, "media_manifest.jsonl")

  await appendManifestLine(manifestPath, { asset_id: "asset-1", title: "first" })
  await appendManifestLine(manifestPath, { asset_id: "asset-2", title: "second" })
  await updateManifestLine(manifestPath, "asset-1", { asset_id: "asset-1", title: "updated" })

  const contents = await readFile(manifestPath, "utf8")
  const lines = contents.trim().split("\n").map(parseJsonLine)

  expect(lines).toEqual([
    { asset_id: "asset-1", title: "updated" },
    { asset_id: "asset-2", title: "second" },
  ])
})

test("updateManifestLine appends line when asset id is missing", async () => {
  const tempDir = await makeTempDir()
  const manifestPath = join(tempDir, "media_manifest.jsonl")

  await appendManifestLine(manifestPath, { asset_id: "asset-1", title: "first" })
  await updateManifestLine(manifestPath, "asset-2", { asset_id: "asset-2", title: "second" })

  const contents = await readFile(manifestPath, "utf8")
  const lines = contents.trim().split("\n").map(parseJsonLine)

  expect(lines).toEqual([
    { asset_id: "asset-1", title: "first" },
    { asset_id: "asset-2", title: "second" },
  ])
})

test("logger writes level-prefixed structured message to stderr", () => {
  const messages: string[] = []
  const originalError = console.error
  console.error = (...data: unknown[]) => {
    messages.push(data.map(String).join(" "))
  }

  logger.info("indexed", { asset_id: "asset-1", count: 2 })
  console.error = originalError

  expect(messages).toEqual(['INFO indexed {"asset_id":"asset-1","count":2}'])
})
