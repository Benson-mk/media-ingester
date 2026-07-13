import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { MediaSidecar } from "../common/schema"
import type { analyzeImage } from "../llm/vlmClient"
import { type EnrichOptions, enrichSidecar } from "./enrichSidecar"

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
let workDir = ""
let imagePath = ""

beforeEach(async () => {
  process.env = { ...originalEnv }
  for (const key of envKeys) delete process.env[key]
  workDir = await mkdtemp(join(tmpdir(), "enrich-"))
  imagePath = join(workDir, "photo.jpg")
  await writeFile(imagePath, Buffer.from("fake-jpeg-bytes"))
})

afterEach(async () => {
  process.env = originalEnv
  await rm(workDir, { recursive: true, force: true })
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

const okAnalyze: typeof analyzeImage = async () =>
  ({ title: "Sunset", short_caption: "A sunset over water", tags: ["sunset", "existing"] }) as never

test("enrichSidecar fills empty summary and appends unique tags from VLM", async () => {
  const result = await enrichSidecar(baseSidecar(), imagePath, {
    apiKey: "k",
    analyze: okAnalyze,
  })

  expect(result.summary.title).toBe("Sunset")
  expect(result.summary.short_caption).toBe("A sunset over water")
  // "existing" not duplicated, "sunset" appended
  expect(result.tags.core).toEqual(["existing", "sunset"])
  expect(result.api_usage.media_uploaded_to_api).toBe(true)
})

test("enrichSidecar preserves non-empty summary fields", async () => {
  const sidecar = baseSidecar({
    summary: {
      title: "Kept",
      short_caption: "Kept caption",
      detailed_caption: "",
      best_use: [],
      not_recommended_for: [],
    },
  })

  const result = await enrichSidecar(sidecar, imagePath, { apiKey: "k", analyze: okAnalyze })

  expect(result.summary.title).toBe("Kept")
  expect(result.summary.short_caption).toBe("Kept caption")
})

test("enrichSidecar treats VLM failure as non-fatal and marks upload false", async () => {
  const failing: typeof analyzeImage = async () => {
    throw new Error("boom")
  }

  const result = await enrichSidecar(baseSidecar(), imagePath, { apiKey: "k", analyze: failing })

  expect(result.summary.title).toBe("")
  expect(result.tags.core).toEqual(["existing"])
  expect(result.api_usage.media_uploaded_to_api).toBe(false)
  expect(result.api_usage.model).toBe("gpt-4o-mini")
})

test("enrichSidecar never modifies source, rights, or asset_id", async () => {
  const sidecar = baseSidecar()
  const result = await enrichSidecar(sidecar, imagePath, { apiKey: "k", analyze: okAnalyze })

  expect(result.asset_id).toBe(sidecar.asset_id)
  expect(result.source).toEqual(sidecar.source)
  expect(result.rights).toEqual(sidecar.rights)
})

test("enrichSidecar uses MEDIA_INGEST_* env fallback for config", async () => {
  process.env["MEDIA_INGEST_API_KEY"] = "env-key"
  process.env["MEDIA_INGEST_BASE_URL"] = "https://env.example/v1"
  process.env["MEDIA_INGEST_MODEL"] = "env-model"

  let seenKey: string | undefined
  let seenBaseUrl = ""
  let seenModel = ""
  const capture: typeof analyzeImage = async (opts) => {
    seenKey = opts.api_key
    seenBaseUrl = opts.base_url
    seenModel = opts.model
    return { title: "T", short_caption: "C", tags: [] } as never
  }

  const result = await enrichSidecar(baseSidecar(), imagePath, { analyze: capture })

  expect(seenKey).toBe("env-key")
  expect(seenBaseUrl).toBe("https://env.example/v1")
  expect(seenModel).toBe("env-model")
  expect(result.api_usage.provider).toBe("https://env.example/v1")
})

test("enrichSidecar stubs video enrichment with warning and no upload", async () => {
  const sidecar = baseSidecar({ media_type: "video" })
  const result = await enrichSidecar(sidecar, imagePath, { apiKey: "k", analyze: okAnalyze })

  expect(result.summary.title).toBe("")
  expect(result.api_usage.media_uploaded_to_api).toBe(false)
})

test("enrichSidecar audio branch calls analyzeAudio and swallows errors", async () => {
  const sidecar = baseSidecar({ media_type: "audio" })
  const calls: Array<{ readonly prompt: string }> = []
  const spy: NonNullable<EnrichOptions["analyzeAudio"]> = async (options) => {
    calls.push({ prompt: options.prompt })
    throw new Error("boom")
  }

  const result = await enrichSidecar(sidecar, imagePath, {
    apiKey: "k",
    analyze: okAnalyze,
    analyzeAudio: spy,
  })

  expect(calls).toHaveLength(1)
  expect(calls[0]?.prompt).toBe("Extract concise audio metadata.")
  expect(result.api_usage.media_uploaded_to_api).toBe(false)
})

type CapturedConfig = { base_url: string; model: string; api_key: string | undefined }

function captureImage(sink: { config?: CapturedConfig }): typeof analyzeImage {
  return async (opts) => {
    sink.config = { base_url: opts.base_url, model: opts.model, api_key: opts.api_key }
    return { title: "T", short_caption: "C", tags: [] } as never
  }
}

function captureAudio(
  sink: { config?: CapturedConfig },
  behavior: "ok" | "throw" = "ok",
): NonNullable<EnrichOptions["analyzeAudio"]> {
  return async (opts) => {
    sink.config = { base_url: opts.base_url, model: opts.model, api_key: opts.api_key }
    if (behavior === "throw") throw new Error("boom")
    return null as never
  }
}

test("enrichSidecar image uses VLM model and inherits base url/key", async () => {
  process.env["MEDIA_INGEST_API_KEY"] = "base-key"
  process.env["MEDIA_INGEST_VLM_MODEL"] = "vlm-model"

  const sink: { config?: CapturedConfig } = {}
  const result = await enrichSidecar(baseSidecar(), imagePath, { analyze: captureImage(sink) })

  expect(sink.config?.model).toBe("vlm-model")
  expect(sink.config?.base_url).toBe("https://api.openai.com/v1")
  expect(sink.config?.api_key).toBe("base-key")
  expect(result.api_usage.model).toBe("vlm-model")
})

test("enrichSidecar image without VLM tier uses base model", async () => {
  process.env["MEDIA_INGEST_API_KEY"] = "base-key"
  process.env["MEDIA_INGEST_MODEL"] = "base-model"

  const sink: { config?: CapturedConfig } = {}
  await enrichSidecar(baseSidecar(), imagePath, { analyze: captureImage(sink) })

  expect(sink.config?.model).toBe("base-model")
})

test("enrichSidecar audio uses full audio tier config", async () => {
  process.env["MEDIA_INGEST_API_KEY"] = "base-key"
  process.env["MEDIA_INGEST_VLM_MODEL"] = "vlm-model"
  process.env["MEDIA_INGEST_VLM_BASE_URL"] = "https://vlm.example/v1"
  process.env["MEDIA_INGEST_AUDIO_MODEL"] = "audio-model"
  process.env["MEDIA_INGEST_AUDIO_BASE_URL"] = "https://audio.example/v1"
  process.env["MEDIA_INGEST_AUDIO_API_KEY"] = "audio-key"

  const sink: { config?: CapturedConfig } = {}
  const result = await enrichSidecar(baseSidecar({ media_type: "audio" }), imagePath, {
    analyzeAudio: captureAudio(sink),
  })

  expect(sink.config?.model).toBe("audio-model")
  expect(sink.config?.base_url).toBe("https://audio.example/v1")
  expect(sink.config?.api_key).toBe("audio-key")
  expect(result.api_usage.provider).toBe("https://audio.example/v1")
})

test("enrichSidecar audio inherits VLM tier when audio tier unset", async () => {
  process.env["MEDIA_INGEST_API_KEY"] = "base-key"
  process.env["MEDIA_INGEST_VLM_MODEL"] = "vlm-model"
  process.env["MEDIA_INGEST_VLM_BASE_URL"] = "https://vlm.example/v1"

  const sink: { config?: CapturedConfig } = {}
  await enrichSidecar(baseSidecar({ media_type: "audio" }), imagePath, {
    analyzeAudio: captureAudio(sink),
  })

  expect(sink.config?.model).toBe("vlm-model")
  expect(sink.config?.base_url).toBe("https://vlm.example/v1")
  expect(sink.config?.api_key).toBe("base-key")
})

test("enrichSidecar audio uses base config when no tiers set", async () => {
  process.env["MEDIA_INGEST_API_KEY"] = "base-key"
  process.env["MEDIA_INGEST_BASE_URL"] = "https://base.example/v1"

  const sink: { config?: CapturedConfig } = {}
  await enrichSidecar(baseSidecar({ media_type: "audio" }), imagePath, {
    analyzeAudio: captureAudio(sink),
  })

  expect(sink.config?.base_url).toBe("https://base.example/v1")
  expect(sink.config?.api_key).toBe("base-key")
})

test("enrichSidecar audio activates tier from API_KEY alone", async () => {
  process.env["MEDIA_INGEST_API_KEY"] = "base-key"
  process.env["MEDIA_INGEST_AUDIO_API_KEY"] = "audio-key"

  const sink: { config?: CapturedConfig } = {}
  await enrichSidecar(baseSidecar({ media_type: "audio" }), imagePath, {
    analyzeAudio: captureAudio(sink),
  })

  expect(sink.config?.api_key).toBe("audio-key")
  expect(sink.config?.model).toBe("gpt-4o-mini")
  expect(sink.config?.base_url).toBe("https://api.openai.com/v1")
})

test("enrichSidecar audio failure records audio-resolved config", async () => {
  process.env["MEDIA_INGEST_AUDIO_BASE_URL"] = "https://audio.example/v1"
  process.env["MEDIA_INGEST_AUDIO_MODEL"] = "audio-model"
  process.env["MEDIA_INGEST_API_KEY"] = "base-key"

  const sink: { config?: CapturedConfig } = {}
  const result = await enrichSidecar(baseSidecar({ media_type: "audio" }), imagePath, {
    analyzeAudio: captureAudio(sink, "throw"),
  })

  expect(result.api_usage.provider).toContain("https://audio.example/v1")
  expect(result.api_usage.model).toBe("audio-model")
})

test("enrichSidecar video api_usage reflects VLM tier", async () => {
  process.env["MEDIA_INGEST_API_KEY"] = "base-key"
  process.env["MEDIA_INGEST_VLM_MODEL"] = "vlm-model"
  process.env["MEDIA_INGEST_VLM_BASE_URL"] = "https://vlm.example/v1"

  const result = await enrichSidecar(baseSidecar({ media_type: "video" }), imagePath, {
    analyze: okAnalyze,
  })

  expect(result.api_usage.model).toBe("vlm-model")
  expect(result.api_usage.provider).toContain("https://vlm.example/v1")
})

test("enrichSidecar treats empty-string tier var as unset", async () => {
  process.env["MEDIA_INGEST_API_KEY"] = "base-key"
  process.env["MEDIA_INGEST_VLM_MODEL"] = ""

  const sink: { config?: CapturedConfig } = {}
  await enrichSidecar(baseSidecar(), imagePath, { analyze: captureImage(sink) })

  expect(sink.config?.model).toBe("gpt-4o-mini")
})
