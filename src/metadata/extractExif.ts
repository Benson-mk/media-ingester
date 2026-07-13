import exifr from "exifr"

import { logger } from "../common/logger"

export type ExifData = Readonly<Record<string, string | number | boolean>>

const SKIPPED_FIELDS = new Set(["ExifIFD", "ExifTag", "MakerNote", "UserComment", "thumbnail"])

function jsonSafe(value: unknown): string | number | boolean | undefined {
  if (typeof value === "string") return value
  if (typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value) && value.every((entry) => typeof entry === "number")) {
    return value.join(", ")
  }
  return undefined
}

export async function extractExif(path: string): Promise<ExifData | null> {
  let parsed: Record<string, unknown> | undefined
  try {
    parsed = (await exifr.parse(path, {
      exif: true,
      gps: true,
      ihdr: false,
      jfif: false,
      xmp: false,
      icc: false,
      iptc: false,
    })) as Record<string, unknown> | undefined
  } catch (error) {
    logger.warn("exif extraction failed", { path, error: String(error) })
    return null
  }
  if (parsed === undefined || parsed === null) return null

  const exif: Record<string, string | number | boolean> = {}
  for (const [field, raw] of Object.entries(parsed)) {
    if (SKIPPED_FIELDS.has(field)) continue
    const value = jsonSafe(raw)
    if (value !== undefined) {
      exif[field] = value
    }
  }
  return Object.keys(exif).length === 0 ? null : exif
}
