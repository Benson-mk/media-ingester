import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runGetCommand } from "../commands/get"
import { MediaSidecarSchema } from "../common/schema"
import type { Provider, ProviderItem } from "../providers/types"

const CDN_URL = "https://cdn.test/dog.jpg"

const FAKE_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

function imageItem(): ProviderItem {
  return {
    provider: "pixabay",
    source_id: "555",
    media_type: "image",
    title: "",
    description: "",
    source_url: "https://pixabay.com/photos/dog-555/",
    download_url: CDN_URL,
    width: 1920,
    height: 1080,
    creator: { name: "Someone", profile_url: "https://pixabay.com/users/someone/" },
    license: "Pixabay Content License",
    license_url: "https://pixabay.com/service/license-summary/",
    credits: { required: false, text: "Someone via Pixabay" },
    api_tags: ["dog", "golden hour", "cinematic"],
    raw: { id: 555 },
    provider_metadata: { engagement: { views: 1 } },
  }
}

function onlyProvider(provider: Provider): () => { ok: true; providers: Provider[] } {
  return () => ({ ok: true, providers: [provider] })
}

function imageProvider(): Provider {
  return {
    id: "pixabay",
    supported: ["image", "video"],
    search: mock(async () => [imageItem()]),
  }
}

const CATEGORIZE_RESULT = {
  tags: {
    core: ["dog"],
    visual: ["golden hour"],
    style: ["cinematic"],
    mood: [],
    audio: [],
    editing: [],
  },
  title: "Test",
  short_caption: "Test",
  best_use: ["editorial"],
  not_recommended_for: [],
}

const IMAGE_RESULT = {
  title: "AI title",
  short_caption: "AI caption",
  detailed_caption: "AI detail",
  best_use: [],
  not_recommended_for: [],
  tags: {
    core: ["ai-tag"],
    visual: [],
    audio: [],
    mood: ["calm"],
    style: [],
    editing: [],
    project: [],
  },
  quality: { overall_score: 7, reuse_score: 6 },
  image: {
    composition: {
      shot_type: "wide",
      main_subject: "dog",
      background: "plain",
      text_space: "top",
      usable_crops: [],
    },
    detected_text: [],
    thumbnail_usefulness: "low",
  },
}

function chatCompletionResponse(payload: unknown): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
    { status: 200 },
  )
}

type RecordedBody = { readonly url: string; readonly body: unknown }

function hasImagePart(body: unknown): boolean {
  const parts =
    (body as { messages?: readonly { content?: readonly { type?: string }[] }[] }).messages?.[0]
      ?.content ?? []
  return parts.some((part) => part.type === "image_url")
}

let savedEnv: NodeJS.ProcessEnv
let outDir: string

beforeEach(async () => {
  savedEnv = { ...process.env }
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("MEDIA_INGEST_")) delete process.env[key]
  }
  process.env["MEDIA_INGEST_API_KEY"] = "env-key"
  process.env["MEDIA_INGEST_BASE_URL"] = "https://llm.example/v1"
  process.exitCode = 0
  outDir = await mkdtemp(join(tmpdir(), "mi-cat-"))
})

afterEach(async () => {
  process.env = savedEnv
  ;(global as { fetch?: unknown }).fetch = undefined
  process.exitCode = 0
  await rm(outDir, { recursive: true, force: true })
})

async function readSidecar(): Promise<ReturnType<typeof MediaSidecarSchema.parse>> {
  const files = await readdir(outDir)
  const sidecarFile = files.find((file) => file.endsWith(".media.json"))
  if (sidecarFile === undefined) throw new Error("missing sidecar")
  return MediaSidecarSchema.parse(JSON.parse(await readFile(join(outDir, sidecarFile), "utf8")))
}

describe("runGetCommand --categorize", () => {
  test("--categorize (no --api): text-only call, media_uploaded_to_api false", async () => {
    const chatCalls: RecordedBody[] = []
    global.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url.includes("chat/completions")) {
        chatCalls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) })
        return chatCompletionResponse(CATEGORIZE_RESULT)
      }
      if (url === CDN_URL) return new Response(FAKE_BYTES, { status: 200 })
      throw new Error(`unexpected URL: ${url}`)
    }) as unknown as typeof fetch

    await runGetCommand(
      "dog",
      { provider: "pixabay", limit: "1", downloadTop: "1", out: outDir, categorize: true },
      { resolveProviders: onlyProvider(imageProvider()), fetchPixabayBootstrap: async () => null },
    )

    expect(chatCalls.length).toBe(1)
    expect(hasImagePart(chatCalls[0]?.body)).toBe(false)

    const sidecar = await readSidecar()
    expect(sidecar.api_usage.media_uploaded_to_api).toBe(false)
    expect(sidecar.tags.visual).toContain("golden hour")
  })

  test("--api: categorize runs BEFORE VLM; final api_usage reflects VLM", async () => {
    const chatCalls: RecordedBody[] = []
    global.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url.includes("chat/completions")) {
        chatCalls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) })
        return chatCompletionResponse(chatCalls.length === 1 ? CATEGORIZE_RESULT : IMAGE_RESULT)
      }
      if (url === CDN_URL) return new Response(FAKE_BYTES, { status: 200 })
      throw new Error(`unexpected URL: ${url}`)
    }) as unknown as typeof fetch

    await runGetCommand(
      "dog",
      { provider: "pixabay", limit: "1", downloadTop: "1", out: outDir, api: true },
      { resolveProviders: onlyProvider(imageProvider()), fetchPixabayBootstrap: async () => null },
    )

    expect(chatCalls.length).toBe(2)
    expect(hasImagePart(chatCalls[0]?.body)).toBe(false)
    expect(hasImagePart(chatCalls[1]?.body)).toBe(true)

    const sidecar = await readSidecar()
    expect(sidecar.api_usage.media_uploaded_to_api).toBe(true)
  })

  test("categorize fetch failure: download + sidecar still written, exit 0", async () => {
    global.fetch = mock(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url.includes("chat/completions")) {
        return new Response("boom", { status: 500 })
      }
      if (url === CDN_URL) return new Response(FAKE_BYTES, { status: 200 })
      throw new Error(`unexpected URL: ${url}`)
    }) as unknown as typeof fetch

    await runGetCommand(
      "dog",
      { provider: "pixabay", limit: "1", downloadTop: "1", out: outDir, categorize: true },
      { resolveProviders: onlyProvider(imageProvider()), fetchPixabayBootstrap: async () => null },
    )

    expect(process.exitCode === 0 || process.exitCode === undefined).toBe(true)
    const sidecar = await readSidecar()
    expect(sidecar.tags.core).toContain("dog")
    expect(sidecar.api_usage.media_uploaded_to_api).toBe(false)
  })

  test("--dry-run --categorize: zero LLM calls", async () => {
    const chatCalls: string[] = []
    global.fetch = mock(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url.includes("chat/completions")) chatCalls.push(url)
      if (url === CDN_URL) return new Response(FAKE_BYTES, { status: 200 })
      return new Response("{}", { status: 200 })
    }) as unknown as typeof fetch

    await runGetCommand(
      "dog",
      {
        provider: "pixabay",
        limit: "1",
        downloadTop: "1",
        out: outDir,
        dryRun: true,
        categorize: true,
      },
      { resolveProviders: onlyProvider(imageProvider()) },
    )

    expect(chatCalls.length).toBe(0)
    expect(process.exitCode === 0 || process.exitCode === undefined).toBe(true)
  })
})
