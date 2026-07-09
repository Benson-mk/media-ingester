import { expect, test } from "bun:test"

import { assetFilename } from "./safeFilename"

test("assetFilename builds provider-sourceId-slug.ext", () => {
  const name = assetFilename(
    "pexels",
    "34081631",
    "Vibrant Colorful Canopy Installation on Blue Bridge",
    "jpeg",
  )
  expect(name.startsWith("pexels-34081631-vibrant-colorful-canopy-")).toBe(true)
  expect(name.endsWith(".jpeg")).toBe(true)
})

test("assetFilename caps slug at 60 chars", () => {
  const longTitle = "a".repeat(200)
  const name = assetFilename("p", "1", longTitle, "png")
  const slug = name.slice("p-1-".length, -".png".length)
  expect(slug.length).toBe(60)
})

test("assetFilename converts special chars to hyphens", () => {
  const name = assetFilename("p", "1", "Hello, World! & More", "png")
  expect(name).toBe("p-1-hello-world-more.png")
})

test("assetFilename accepts ext with or without leading dot", () => {
  expect(assetFilename("p", "1", "x", ".mp4")).toBe("p-1-x.mp4")
  expect(assetFilename("p", "1", "x", "mp4")).toBe("p-1-x.mp4")
})

test("assetFilename strips leading and trailing hyphens from slug", () => {
  expect(assetFilename("p", "1", "  --Trim Me--  ", "png")).toBe("p-1-trim-me.png")
})
