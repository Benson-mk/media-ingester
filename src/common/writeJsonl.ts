import { appendFile, readFile, writeFile } from "node:fs/promises"
import { z } from "zod"

export type JsonlRecord = Record<string, unknown> & { readonly asset_id?: unknown }

const ManifestAssetSchema = z.object({ asset_id: z.string() }).passthrough()

export async function appendManifestLine(filePath: string, record: JsonlRecord): Promise<void> {
  await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8")
}

export async function updateManifestLine(
  filePath: string,
  assetId: string,
  replacement: JsonlRecord,
): Promise<void> {
  const existing = await readExistingManifest(filePath)
  const replacementLine = JSON.stringify(replacement)
  let replaced = false
  const lines = existing.map((line) => {
    const parsed: unknown = JSON.parse(line)
    const result = ManifestAssetSchema.safeParse(parsed)
    if (result.success && result.data.asset_id === assetId) {
      replaced = true
      return replacementLine
    }
    return line
  })

  if (!replaced) {
    lines.push(replacementLine)
  }

  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8")
}

async function readExistingManifest(filePath: string): Promise<string[]> {
  try {
    const contents = await readFile(filePath, "utf8")
    return contents.trim().length === 0 ? [] : contents.trimEnd().split("\n")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return []
    }
    throw error
  }
}
