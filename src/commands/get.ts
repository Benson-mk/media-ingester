import { join } from "node:path"
import { detectMediaType } from "../common/detectMediaType"
import { logger } from "../common/logger"
import { sidecarPath } from "../common/paths"
import { assetFilename } from "../common/safeFilename"
import { writeJson } from "../common/writeJson"
import { updateManifestLine } from "../common/writeJsonl"
import { fetchPexelsJsonLd } from "../crawl/extractPexelsJsonLd"
import { fetchPixabayBootstrap } from "../crawl/pixabayBootstrap"
import { buildExternalSidecar } from "../download/buildSidecar"
import { downloadAsset } from "../download/downloadAsset"
import { extractExif } from "../metadata/extractExif"
import type { Provider, ProviderItem } from "../providers/types"
import { categorizeSidecar } from "../tagging/categorizeSidecar"
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
  readonly categorize?: boolean
  readonly apiKey?: string
  readonly apiBaseUrl?: string
  readonly apiModel?: string
}

export type GetDependencies = {
  readonly resolveProviders?: typeof resolveProviders
  readonly fetchPixabayBootstrap?: typeof fetchPixabayBootstrap
}

function extensionFor(item: ProviderItem): string {
  const fromUrl = item.download_url.split(".").pop()?.split("?")[0]
  if (fromUrl !== undefined && fromUrl.length > 0 && fromUrl.length <= 5) return fromUrl
  return item.media_type === "image" ? "jpg" : "mp4"
}

type ProviderResult = {
  provider: Provider
  item: ProviderItem
}

export async function runGetCommand(
  query: string,
  options: GetOptions,
  dependencies: GetDependencies = {},
): Promise<void> {
  const resolved = (dependencies.resolveProviders ?? resolveProviders)(options.provider)
  if (!resolved.ok) return

  const type = parseMediaType(options.type)
  const limit = parseLimit(options.limit, 10)
  const downloadTop = parseLimit(options.downloadTop, 3)
  const outDir = options.out ?? "./assets"
  const manifestFilePath = options.output ?? join(outDir, "media_manifest.jsonl")

  const results: ProviderResult[] = []
  let errored = false
  for (const provider of resolved.providers) {
    try {
      const items = await provider.search(query, type, limit)
      results.push(...items.map((item) => ({ provider, item })))
    } catch (error) {
      errored = true
      process.exitCode = 1
      console.error(error instanceof Error ? error.message : `provider ${provider.id} failed`)
    }
  }

  if (errored && results.length === 0) return

  const selected = results.slice(0, downloadTop)

  if (options.dryRun === true) {
    for (const { item } of selected) {
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

  for (const { item: searchItem, provider } of selected) {
    const ext = extensionFor(searchItem)
    const filename = assetFilename(
      searchItem.provider,
      searchItem.source_id,
      searchItem.title || searchItem.source_id,
      ext,
    )

    let item = searchItem
    let jsonLd: Awaited<ReturnType<typeof fetchPexelsJsonLd>> = null
    let pixabayBootstrap: Awaited<ReturnType<typeof fetchPixabayBootstrap>> = null
    const result = await downloadAsset(searchItem.download_url, outDir, filename, {
      force: options.force === true,
      prepareDownload: async () => {
        item =
          provider.getDetails === undefined ? searchItem : await provider.getDetails(searchItem)
        jsonLd = item.provider === "pexels" ? await fetchPexelsJsonLd(item.source_url) : null
        if (item.provider === "pixabay") {
          try {
            pixabayBootstrap = await (dependencies.fetchPixabayBootstrap ?? fetchPixabayBootstrap)(
              item.source_url,
              item.source_id,
            )
          } catch {
            logger.warn("pixabay page metadata enrichment failed unexpectedly")
            pixabayBootstrap = null
          }
        }
        if (provider.trackDownload !== undefined) {
          await provider.trackDownload(item)
        }
        return item.download_url
      },
    })
    if (!result.downloaded) {
      console.log(`Skipped: ${result.path}`)
      continue
    }

    const detectedType = detectMediaType(result.path)
    if (detectedType !== null && detectedType !== item.media_type) {
      logger.warn("media type mismatch: detected different type from file extension", {
        expected: item.media_type,
        detected: detectedType,
        file: result.path,
      })
    }
    const embeddedExif =
      item.provider === "wikimedia" && item.media_type === "image"
        ? await extractExif(result.path)
        : null
    let sidecar = buildExternalSidecar(
      item,
      jsonLd,
      result.path,
      result.sha256,
      embeddedExif,
      pixabayBootstrap,
    )

    if (options.categorize === true || options.api === true) {
      sidecar = await categorizeSidecar(sidecar, {
        ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
        ...(options.apiBaseUrl !== undefined ? { apiBaseUrl: options.apiBaseUrl } : {}),
        ...(options.apiModel !== undefined ? { apiModel: options.apiModel } : {}),
        willEnrich: options.api === true,
      })
    }

    if (options.api === true) {
      sidecar = await enrichSidecar(sidecar, result.path, {
        ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
        ...(options.apiBaseUrl !== undefined ? { apiBaseUrl: options.apiBaseUrl } : {}),
        ...(options.apiModel !== undefined ? { apiModel: options.apiModel } : {}),
      })
    }

    await writeJson(sidecarPath(result.path), sidecar)
    await updateManifestLine(manifestFilePath, sidecar.asset_id, sidecar)

    console.log(`Downloaded: ${result.path}`)
  }
}
