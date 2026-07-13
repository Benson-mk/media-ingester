import { existsSync, mkdirSync } from "node:fs"
import { unlink } from "node:fs/promises"
import { join } from "node:path"

import { hashFile } from "../common/hashFile"
import { sidecarPath } from "../common/paths"

export type DownloadOptions = {
  force?: boolean
  prepareDownload?: () => Promise<string>
}

export type DownloadResult = {
  path: string
  sha256: string
  downloaded: boolean
}

export async function downloadAsset(
  url: string,
  outDir: string,
  filename: string,
  options: DownloadOptions = {},
): Promise<DownloadResult> {
  const targetPath = join(outDir, filename)

  if (options.force !== true && existsSync(targetPath) && existsSync(sidecarPath(targetPath))) {
    return { path: targetPath, sha256: await hashFile(targetPath), downloaded: false }
  }

  const finalUrl = options.prepareDownload === undefined ? url : await options.prepareDownload()
  if (finalUrl.length === 0) {
    throw new Error("Download preparation returned an empty URL")
  }

  mkdirSync(outDir, { recursive: true })

  const response = await fetch(finalUrl)
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} for ${finalUrl}`)
  }
  const buffer = await response.arrayBuffer()

  try {
    await Bun.write(targetPath, buffer)
    const sha256 = await hashFile(targetPath)
    return { path: targetPath, sha256, downloaded: true }
  } catch (error) {
    await unlink(targetPath).catch(() => {})
    throw error
  }
}
