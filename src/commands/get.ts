import { join } from "node:path"
import { detectMediaType } from "../common/detectMediaType"
import { logger } from "../common/logger"
import { rawMetadataPath, sidecarPath } from "../common/paths"
import { assetFilename } from "../common/safeFilename"
import { writeJson } from "../common/writeJson"
import { updateManifestLine } from "../common/writeJsonl"
import { fetchPexelsJsonLd } from "../crawl/extractJsonLd"
import { buildExternalSidecar } from "../download/buildSidecar"
import { downloadAsset } from "../download/downloadAsset"
import { saveRaw } from "../download/saveRaw"
import type { ProviderItem } from "../providers/types"
import { enrichSidecar } from "../tagging/enrichSidecar"
import { parseLimit, parseMediaType, resolveProviders } from "./resolveProviders"

export type GetOptions = {
  readonly type?: string
  readonly provider?: string
  readonly limit?: string
  readonly downloadTop?: string
  readonly out?: string
  readonly force?: boolean
  readonly dryRun?: boolean
  readonly output?: string
  readonly api?: boolean
  readonly apiKey?: string
  readonly apiBaseUrl?: string
  readonly apiModel?: string
}

function extensionFor(item: ProviderItem): string {
  const fromUrl = item.download_url.split(".").pop()?.split("?")[0]
  if (fromUrl !== undefined && fromUrl.length > 0 && fromUrl.length <= 5) return fromUrl
  return item.media_type === "image" ? "jpg" : "mp4"
}

export async function runGetCommand(query: string, options: GetOptions): Promise<void> {
  const resolved = resolveProviders(options.provider)
  if (!resolved.ok) return

  const type = parseMediaType(options.type)
  const limit = parseLimit(options.limit, 10)
  const downloadTop = parseLimit(options.downloadTop, 3)
  const outDir = options.out ?? "./assets"
  const manifestFilePath = options.output ?? join(outDir, "media_manifest.jsonl")

  const results: ProviderItem[] = []
  let errored = false
  for (const provider of resolved.providers) {
    try {
      const items = await provider.search(query, type, limit)
      results.push(...items)
    } catch (error) {
      errored = true
      process.exitCode = 1
      console.error(error instanceof Error ? error.message : `provider ${provider.id} failed`)
    }
  }

  if (errored && results.length === 0) return

  const selected = results.slice(0, downloadTop)

  if (options.dryRun === true) {
    for (const item of selected) {
      const ext = extensionFor(item)
      const filename = assetFilename(
        item.provider,
        item.source_id,
        item.title || item.description || item.source_id,
        ext,
      )
      console.log(`${item.source_url} -> ${join(outDir, filename)} [${item.media_type}]`)
    }
    return
  }

  for (const item of selected) {
    const ext = extensionFor(item)
    const filename = assetFilename(item.provider, item.source_id, item.title || item.source_id, ext)

    const jsonLd = item.provider === "pexels" ? await fetchPexelsJsonLd(item.source_url) : null

    const result = await downloadAsset(item.download_url, outDir, filename, {
      force: options.force === true,
    })
    const detectedType = detectMediaType(result.path)
    if (detectedType !== null && detectedType !== item.media_type) {
      logger.warn("media type mismatch: detected different type from file extension", {
        expected: item.media_type,
        detected: detectedType,
        file: result.path,
      })
    }
    const rawPath = rawMetadataPath(result.path)
    let sidecar = buildExternalSidecar(item, jsonLd, result.path, result.sha256, rawPath)

    if (options.api === true && options.apiKey !== undefined) {
      sidecar = await enrichSidecar(sidecar, result.path, {
        apiKey: options.apiKey,
        ...(options.apiBaseUrl !== undefined ? { apiBaseUrl: options.apiBaseUrl } : {}),
        ...(options.apiModel !== undefined ? { apiModel: options.apiModel } : {}),
      })
    }

    await writeJson(sidecarPath(result.path), sidecar)
    await saveRaw(rawPath, item, jsonLd)
    await updateManifestLine(manifestFilePath, sidecar.asset_id, sidecar)

    console.log(`Downloaded: ${result.path}`)
  }
}
