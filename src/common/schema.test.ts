import { describe, expect, test } from "bun:test"
import { MediaSidecarSchema } from "./schema"

const baseSidecar = {
  asset_id: "a1",
  source_file: "img.jpg",
  media_type: "image" as const,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  technical: { width: 1920, height: 1080 },
  summary: {
    title: "t",
    short_caption: "s",
    detailed_caption: "d",
    best_use: [],
    not_recommended_for: [],
  },
  tags: { core: [], visual: [], audio: [], mood: [], style: [], editing: [], project: [] },
  quality: { overall_score: 0.9, reuse_score: 0.8 },
  rights: { owner: "o", source: "s", license: "l", notes: "n" },
  api_usage: { provider: "p", model: "m", media_uploaded_to_api: false },
}

describe("MediaSidecarSchema", () => {
  test("v1.0 sidecar without new blocks parses OK", () => {
    const result = MediaSidecarSchema.parse({ ...baseSidecar, schema_version: "1.0" })
    expect(result.schema_version).toBe("1.0")
    expect(result.external).toBeUndefined()
    expect(result.internal).toBeUndefined()
  })

  test("v1.1 sidecar with external+exif+location parses OK", () => {
    const result = MediaSidecarSchema.parse({
      ...baseSidecar,
      schema_version: "1.1",
      external: {
        provider: "pexels",
        source_id: "12345",
        source_url: "https://pexels.com/photo/12345",
        download_url: "https://images.pexels.com/12345.jpg",
        creator: { name: "Jane Doe", profile_url: "https://pexels.com/@jane" },
        license: "Pexels License",
        license_url: "https://pexels.com/license",
        credits: { required: false, text: "Photo by Jane Doe" },
        raw_metadata_path: "raw/12345.json",
        exif: { camera: "Canon", iso: 400 },
        location: "Paris, France",
      },
      internal: { origin: "crawler" },
    })
    expect(result.schema_version).toBe("1.1")
    expect(result.external?.provider).toBe("pexels")
    expect(result.external?.exif?.["iso"]).toBe(400)
    expect(result.external?.location).toBe("Paris, France")
    expect(result.internal?.origin).toBe("crawler")
  })

  test("bad external.provider type (number) rejects", () => {
    const result = MediaSidecarSchema.safeParse({
      ...baseSidecar,
      schema_version: "1.1",
      external: {
        provider: 123,
        source_id: "12345",
        source_url: "u",
        download_url: "u",
        creator: { name: "n", profile_url: "u" },
        license: "l",
        license_url: "u",
        credits: { required: false, text: "t" },
        raw_metadata_path: "p",
      },
    })
    expect(result.success).toBe(false)
  })
})
