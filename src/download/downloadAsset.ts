import { existsSync, mkdirSync } from "node:fs"
import { unlink } from "node:fs/promises"
import { join } from "node:path"

import { hashFile } from "../common/hashFile"
import { sidecarPath } from "../common/paths"

export type DownloadOptions = {
  force?: boolean
}

export type DownloadResult = {
  path: string
  sha256: string
}

export async function downloadAsset(
  url: string,
  outDir: string,
  filename: string,
  options: DownloadOptions = {},
): Promise<DownloadResult> {
  const targetPath = join(outDir, filename)

  if (options.force !== true && existsSync(targetPath) && existsSync(sidecarPath(targetPath))) {
    return { path: targetPath, sha256: await hashFile(targetPath) }
  }

  mkdirSync(outDir, { recursive: true })

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} for ${url}`)
  }
  const buffer = await response.arrayBuffer()

  try {
    await Bun.write(targetPath, buffer)
    const sha256 = await hashFile(targetPath)
    return { path: targetPath, sha256 }
  } catch (error) {
    await unlink(targetPath).catch(() => {})
    throw error
  }
}
