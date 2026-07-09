import { extname } from "node:path"

export type MediaType = "image" | "video" | "audio"

const MEDIA_TYPES: Readonly<Record<string, MediaType>> = {
  jpg: "image",
  jpeg: "image",
  png: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  tiff: "image",
  bmp: "image",
  mp4: "video",
  mov: "video",
  avi: "video",
  mkv: "video",
  webm: "video",
  m4v: "video",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  flac: "audio",
  aac: "audio",
  m4a: "audio",
  wma: "audio",
}

export function detectMediaType(input: string): MediaType | null {
  const extension = extname(input) || input
  return MEDIA_TYPES[extension.replace(/^\./, "").toLowerCase()] ?? null
}
