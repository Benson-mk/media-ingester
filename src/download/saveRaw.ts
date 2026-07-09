import { writeJson } from "../common/writeJson"
import type { PexelsJsonLd } from "../crawl/extractJsonLd"
import type { ProviderItem } from "../providers/types"

export async function saveRaw(
  rawPath: string,
  item: ProviderItem,
  jsonLd: PexelsJsonLd | null,
): Promise<void> {
  await writeJson(rawPath, { api: item.raw, json_ld: jsonLd })
}
