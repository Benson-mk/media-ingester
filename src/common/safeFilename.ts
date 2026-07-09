/**
 * Build a collision-proof asset filename.
 * slug: lowercased, non-alnum → '-', max 60 chars, no leading/trailing hyphens
 */
export function assetFilename(
  provider: string,
  sourceId: string,
  slugOrTitle: string,
  ext: string,
): string {
  const slug = slugOrTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
  const cleanExt = ext.startsWith(".") ? ext.slice(1) : ext
  return `${provider}-${sourceId}-${slug}.${cleanExt}`
}
