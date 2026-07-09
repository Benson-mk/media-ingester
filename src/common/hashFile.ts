import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"

export async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256")
  const stream = createReadStream(filePath)

  for await (const chunk of stream) {
    hash.update(chunk)
  }

  return hash.digest("hex")
}
