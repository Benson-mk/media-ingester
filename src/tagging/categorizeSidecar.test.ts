import { afterEach, beforeEach, expect, test } from "bun:test"

import type { MediaSidecar } from "../common/schema"
import type { requestStructuredChatCompletion } from "../llm/vlmClient"
import type { CategorizeResult } from "./buildCategorizePrompt"
import { categorizeSidecar } from "./categorizeSidecar"

const envKeys = [
  "MEDIA_INGEST_API_KEY",
  "MEDIA_INGEST_BASE_URL",
  "MEDIA_INGEST_MODEL",
  "MEDIA_INGEST_VLM_BASE_URL",
  "MEDIA_INGEST_VLM_MODEL",
  "MEDIA_INGEST_VLM_API_KEY",
  "MEDIA_INGEST_AUDIO_BASE_URL",
  "MEDIA_INGEST_AUDIO_MODEL",
  "MEDIA_INGEST_AUDIO_API_KEY",
] as const

const originalEnv = process.env

beforeEach(() => {
  process.env = { ...originalEnv }
  for (const key of envKeys) delete process.env[key]
  process.env["MEDIA_INGEST_API_KEY"] = "test-key"
  process.env["MEDIA_INGEST_BASE_URL"] = "https://api.test"
})

afterEach(() => {
  process.env = originalEnv
})

function baseSidecar(overrides: Partial<MediaSidecar> = {}): MediaSidecar {
  return {
    schema_version: "1.1",
    asset_id: "pexels-123",
    source_file: "photo.jpg",
    media_type: "image",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    technical: {},
    summary: {
      title: "",
      short_caption: "",
      detailed_caption: "",
      best_use: [],
      not_recommended_for: [],
    },
    tags: {
      core: ["existing"],
      visual: [],
      audio: [],
      mood: [],
      style: [],
      editing: [],
      project: [],
    },
    quality: { overall_score: 0, reuse_score: 0 },
    rights: { owner: "creator", source: "pexels", license: "CC0", notes: "" },
    api_usage: { provider: "", model: "", media_uploaded_to_api: false },
    source: {
      origin: "external",
      provider: "pexels",
      source_id: "123",
      source_url: "https://example.test/p/123",
      download_url: "https://example.test/dl/123.jpg",
      creator: { name: "Jane", profile_url: "https://example.test/jane" },
      license: "CC0",
      license_url: "https://example.test/cc0",
      credits: { required: false, text: "Photo by Jane" },
      raw_metadata_path: "photo.raw.json",
    },
    ...overrides,
  }
}

function catResult(overrides: Partial<CategorizeResult> = {}): CategorizeResult {
  return {
    tags: { core: [], visual: [], audio: [], mood: [], style: [], editing: [] },
    title: "",
    short_caption: "",
    best_use: [],
    not_recommended_for: [],
    ...overrides,
  }
}

// Typed as the real client so it drops into options.request without casts.
function mockRequest(result: CategorizeResult | null): typeof requestStructuredChatCompletion {
  return (async () => result as unknown) as typeof requestStructuredChatCompletion
}

function throwingRequest(message: string): typeof requestStructuredChatCompletion {
  return (async () => {
    throw new Error(message)
  }) as typeof requestStructuredChatCompletion
}

// (a) moves tags out of core into facet buckets per mocked response
test("moves tags into facet buckets per mocked response", async () => {
  const sidecar = baseSidecar({
    tags: {
      core: ["dog", "golden hour", "cinematic", "calm"],
      visual: [],
      audio: [],
      mood: [],
      style: [],
      editing: [],
      project: [],
    },
  })
  const request = mockRequest(
    catResult({
      tags: {
        core: ["dog"],
        visual: ["golden hour"],
        audio: [],
        mood: ["calm"],
        style: ["cinematic"],
        editing: [],
      },
    }),
  )

  const result = await categorizeSidecar(sidecar, { request })

  expect(result.tags.core).toEqual(["dog"])
  expect(result.tags.visual).toContain("golden hour")
  expect(result.tags.style).toContain("cinematic")
  expect(result.tags.mood).toContain("calm")
})

// (b) safety net re-appends dropped original tags to core
test("safety net re-appends dropped original tags to core", async () => {
  const sidecar = baseSidecar({
    tags: {
      core: ["dog", "secret", "golden hour"],
      visual: [],
      audio: [],
      mood: [],
      style: [],
      editing: [],
      project: [],
    },
  })
  const request = mockRequest(
    catResult({
      tags: {
        core: ["dog"],
        visual: ["golden hour"],
        audio: [],
        mood: [],
        style: [],
        editing: [],
      },
    }),
  )

  const result = await categorizeSidecar(sidecar, { request })

  expect(result.tags.core).toContain("secret")
})

// (c) never writes tags.project even if LLM returns project tags
test("never writes tags.project", async () => {
  const sidecar = baseSidecar()
  const request = mockRequest(
    catResult({ tags: { core: ["x"], visual: [], audio: [], mood: [], style: [], editing: [] } }),
  )

  const result = await categorizeSidecar(sidecar, { request })

  expect(result.tags.project).toEqual(sidecar.tags.project)
})

// (d) title filled only when empty
test("title filled only when empty", async () => {
  const emptyTitle = baseSidecar({
    summary: {
      title: "",
      short_caption: "",
      detailed_caption: "",
      best_use: [],
      not_recommended_for: [],
    },
  })
  const filled = await categorizeSidecar(emptyTitle, {
    request: mockRequest(
      catResult({
        tags: { core: ["x"], visual: [], audio: [], mood: [], style: [], editing: [] },
        title: "Beach",
      }),
    ),
  })
  expect(filled.summary.title).toBe("Beach")

  const existingTitle = baseSidecar({
    summary: {
      title: "Existing",
      short_caption: "",
      detailed_caption: "",
      best_use: [],
      not_recommended_for: [],
    },
  })
  const kept = await categorizeSidecar(existingTitle, {
    request: mockRequest(
      catResult({
        tags: { core: ["x"], visual: [], audio: [], mood: [], style: [], editing: [] },
        title: "Different",
      }),
    ),
  })
  expect(kept.summary.title).toBe("Existing")
})

// (e) best_use/not_recommended_for filled when willEnrich=false, ignored when willEnrich=true
test("use fields respect willEnrich flag", async () => {
  const request = mockRequest(catResult({ best_use: ["editorial"] }))

  const enrichLater = await categorizeSidecar(baseSidecar(), { request, willEnrich: true })
  expect(enrichLater.summary.best_use).toEqual([])

  const noEnrich = await categorizeSidecar(baseSidecar(), { request, willEnrich: false })
  expect(noEnrich.summary.best_use).toContain("editorial")
})

// (f) request throws → sidecar tags unchanged, api_usage media_uploaded_to_api:false
test("request throws leaves tags unchanged with failed usage", async () => {
  const sidecar = baseSidecar()
  const result = await categorizeSidecar(sidecar, { request: throwingRequest("API error") })

  expect(result.tags.core).toEqual(sidecar.tags.core)
  expect(result.api_usage.media_uploaded_to_api).toBe(false)
})

// (g) request returns null → same behavior as (f)
test("request returns null leaves tags unchanged with failed usage", async () => {
  const sidecar = baseSidecar()
  const result = await categorizeSidecar(sidecar, { request: mockRequest(null) })

  expect(result.tags.core).toEqual(sidecar.tags.core)
  expect(result.api_usage.media_uploaded_to_api).toBe(false)
})

// (h) source, rights, asset_id untouched
test("source, rights, asset_id untouched", async () => {
  const sidecar = baseSidecar()
  const request = mockRequest(
    catResult({ tags: { core: ["x"], visual: [], audio: [], mood: [], style: [], editing: [] } }),
  )

  const result = await categorizeSidecar(sidecar, { request })

  expect(result.source).toBe(sidecar.source)
  expect(result.rights).toBe(sidecar.rights)
  expect(result.asset_id).toBe(sidecar.asset_id)
})

// (i) empty core + filled title/short_caption → no request call made
test("empty core with filled summary skips the request", async () => {
  const sidecar = baseSidecar({
    tags: { core: [], visual: [], audio: [], mood: [], style: [], editing: [], project: [] },
    summary: {
      title: "X",
      short_caption: "Y",
      detailed_caption: "",
      best_use: [],
      not_recommended_for: [],
    },
  })

  const result = await categorizeSidecar(sidecar, {
    request: throwingRequest("should not be called"),
  })

  expect(result).toBe(sidecar)
})
