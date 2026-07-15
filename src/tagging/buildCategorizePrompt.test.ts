import { describe, expect, test } from "bun:test"
import {
  buildCategorizePrompt,
  type CategorizePromptInput,
  CategorizeResultSchema,
} from "./buildCategorizePrompt"

function baseInput(overrides: Partial<CategorizePromptInput> = {}): CategorizePromptInput {
  return {
    media_type: "image",
    core_tags: ["dog", "golden hour", "cinematic", "calm"],
    title: "A dog",
    short_caption: "A calm dog",
    provider: "pexels",
    technical: { width: 1920, height: 1080, duration: null, aspect_ratio: "16:9" },
    include_use_fields: false,
    ...overrides,
  }
}

describe("buildCategorizePrompt", () => {
  test("(a) contains each input tag verbatim", () => {
    const prompt = buildCategorizePrompt(baseInput())
    for (const tag of ["dog", "golden hour", "cinematic", "calm"]) {
      expect(prompt).toContain(tag)
    }
  })

  test("(b) contains bucket rubric", () => {
    const prompt = buildCategorizePrompt(baseInput())
    for (const bucket of ["visual", "mood", "style", "editing", "audio", "core"]) {
      expect(prompt).toContain(bucket)
    }
  })

  test("(c) include_use_fields true mentions use fields", () => {
    const prompt = buildCategorizePrompt(baseInput({ include_use_fields: true }))
    expect(prompt.includes("best_use") || prompt.includes("not_recommended_for")).toBe(true)
  })
})

describe("CategorizeResultSchema", () => {
  test("(d) parses valid result with empty use fields", () => {
    const parsed = CategorizeResultSchema.parse({
      tags: { core: [], visual: [], audio: [], mood: [], style: [], editing: [] },
      title: "",
      short_caption: "",
      best_use: [],
      not_recommended_for: [],
    })
    expect(parsed.best_use).toEqual([])
    expect(parsed.not_recommended_for).toEqual([])
  })

  test("(e) throws on missing required fields", () => {
    expect(() => CategorizeResultSchema.parse({})).toThrow()
  })

  test("(f) strips extra project key from tags", () => {
    const parsed = CategorizeResultSchema.parse({
      tags: {
        core: [],
        visual: [],
        audio: [],
        mood: [],
        style: [],
        editing: [],
        project: ["x"],
      },
      title: "",
      short_caption: "",
      best_use: [],
      not_recommended_for: [],
    })
    expect("project" in parsed.tags).toBe(false)
  })
})
