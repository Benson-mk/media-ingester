import { rename, writeFile } from "node:fs/promises"

import { sidecarPath } from "./paths"

export type JsonRecord = Record<string, unknown>

export async function writeJson(filePath: string, value: JsonRecord): Promise<void> {
  const tempPath = `${filePath}.tmp-${crypto.randomUUID()}`
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
  await rename(tempPath, filePath)
}

export async function writeSidecar(mediaPath: string, value: JsonRecord): Promise<void> {
  await writeJson(sidecarPath(mediaPath), value)
}
