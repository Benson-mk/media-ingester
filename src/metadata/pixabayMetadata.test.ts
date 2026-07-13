import { describe, expect, test } from "bun:test"
import type { ProviderItem } from "../providers/types"
import {
  mergePixabayProviderMetadata,
  pixabayAttributionText,
  pixabayBootstrapCaption,
  pixabayBootstrapExif,
} from "./pixabayMetadata"

function item(): ProviderItem {
  return {
    provider: "pixabay",
    source_id: "10359152",
    media_type: "image",
    title: "lake",
    description: "lake, swan",
    source_url: "https://pixabay.com/photos/lake-swan-mountains-winter-nature-10359152/",
    download_url: "https://cdn.pixabay.com/photo.jpg",
    creator: { name: "RosZie", profile_url: "https://pixabay.com/users/roszie-123/" },
    license: "Pixabay Content License",
    license_url: "https://pixabay.com/service/license-summary/",
    api_tags: ["lake", "swan"],
    raw: { id: 10359152 },
    provider_metadata: {
      engagement: { views: 111, downloads: 22 },
      content_flags: { is_ai_generated: false },
    },
  }
}

describe("Pixabay bootstrap metadata normalization", () => {
  test("normalizes EXIF including boolean Flash", () => {
    expect(
      pixabayBootstrapExif({
        cameraName: "Sony Ilce-7rm3",
        lens: "E 70-180mm F2.8 A056",
        aperture: "8.0",
        exposureTime: "1/320",
        focalLength: "82.0",
        iso: "100",
        flash: false,
      }),
    ).toEqual({
      Model: "Sony Ilce-7rm3",
      Lens: "E 70-180mm F2.8 A056",
      FNumber: 8,
      ExposureTime: "1/320",
      FocalLength: 82,
      ISO: 100,
      Flash: false,
    })
  })

  test("adds website-only metadata without replacing API engagement", () => {
    const bootstrap = {
      id: 10359152,
      viewCount: 999999,
      isEditorsChoice: true,
      nsfw: false,
      qualityStatus: "approved",
      fileFormat: "jpg",
      vector: false,
      uploadDate: "2026-07-02T00:00:00Z",
      publishedDate: "2026-07-02T00:00:00Z",
      downloadSources: [{ label: "4K", width: 3840 }],
      user: { id: 123, followerCount: 77 },
      attributionHtml: '<a href="https://pixabay.com/">Lake &amp; swan</a>',
      description: "A swan crossing a winter lake",
      themes: ["Nature"],
    }

    const metadata = mergePixabayProviderMetadata(item(), bootstrap)

    expect(metadata?.["engagement"]).toEqual({ views: 111, downloads: 22 })
    expect(metadata?.["curation"]).toEqual({
      editors_choice: true,
      nsfw: false,
      quality_status: "approved",
    })
    expect(metadata?.["file"]).toEqual({ format: "jpg", vector: false })
    expect(metadata?.["download_variants"]).toEqual([{ label: "4K", width: 3840 }])
    expect(metadata?.["contributor"]).toEqual({ id: 123, followerCount: 77 })
    expect(metadata?.["attribution_text"]).toBe("Lake & swan")
  })

  test("caption precedence is description, alt, then API tags", () => {
    expect(
      pixabayBootstrapCaption({ description: "Description", alt: "Alt" }, ["api", "tags"]),
    ).toBe("Description")
    expect(pixabayBootstrapCaption({ description: " ", alt: "Alt" }, ["api", "tags"])).toBe("Alt")
    expect(pixabayBootstrapCaption({ description: "", alt: "" }, ["api", "tags"])).toBe("api, tags")
  })

  test("plain-text attribution removes tags, script contents, and decodes entities", () => {
    expect(
      pixabayAttributionText(
        '<strong>Photo</strong> by <a href="https://example.com">A &amp; B</a><script>bad()</script>',
      ),
    ).toBe("Photo by A & B")
  })
})
