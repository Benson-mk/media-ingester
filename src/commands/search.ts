import type { ProviderItem } from "../providers/types"
import { parseLimit, parseMediaType, resolveProviders } from "./resolveProviders"

export type SearchOptions = {
  readonly type?: string
  readonly provider?: string
  readonly limit?: string
}

export async function runSearchCommand(query: string, options: SearchOptions): Promise<void> {
  const resolved = resolveProviders(options.provider)
  if (!resolved.ok) return

  const type = parseMediaType(options.type)
  const limit = parseLimit(options.limit, 10)

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

  const printable = results.map(({ raw: _raw, ...rest }) => rest)
  console.log(JSON.stringify(printable, null, 2))
}
