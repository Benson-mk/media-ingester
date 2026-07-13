import { join, parse } from "node:path"

export function sidecarPath(mediaPath: string): string {
  if (mediaPath.length === 0) {
    throw new Error("media path cannot be empty")
  }

  if (mediaPath.endsWith(".media.json")) {
    return mediaPath
  }

  const parsedPath = parse(mediaPath)
  return join(parsedPath.dir, `${parsedPath.name}.media.json`)
}

export function manifestPath(rootPath: string): string {
  return join(rootPath, "media_manifest.jsonl")
}
