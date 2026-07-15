import { Command } from "commander"

import { type GetOptions, runGetCommand } from "./commands/get"
import { runSearchCommand, type SearchOptions } from "./commands/search"

const program = new Command()

program
  .name("media-ingester")
  .version("0.1.0")
  .description(
    "Search and download stock media from Pexels, Pixabay, Unsplash, and Wikimedia.\n" +
      "Writes a <name>.media.json tag sidecar (schema v1.1) per asset plus a media_manifest.jsonl.",
  )
  .addHelpText(
    "after",
    `
Environment variables:
  Providers (blank counts as unset; keyless providers: wikimedia):
    PEXELS_API_KEY              Pexels API key
    PIXABAY_API_KEY             Pixabay API key
    UNSPLASH_ACCESS_KEY         Unsplash access key

  AI enrichment (--api; OpenAI-compatible endpoint):
    MEDIA_INGEST_API_KEY        API key (text tier; VLM/audio tiers inherit)
    MEDIA_INGEST_BASE_URL       Base URL
    MEDIA_INGEST_MODEL          Model name
    MEDIA_INGEST_VLM_*          Image/video tier overrides (API_KEY, BASE_URL, MODEL)
    MEDIA_INGEST_AUDIO_*        Audio tier overrides (API_KEY, BASE_URL, MODEL)

Examples:
  $ media-ingester search "mountain lake" --type image --provider pexels
  $ media-ingester get "rain ambience" --type audio --download-top 5 --out ./assets
  $ media-ingester get "city timelapse" --type video --api --dry-run

Notes:
  --provider all skips keyed providers with missing keys (warns); selecting one explicitly without its key errors.
  --api requires ffmpeg for video/audio enrichment.
`,
  )

program
  .command("search <query>")
  .description("Search stock media providers")
  .option("--type <type>", "Media type: image|video|audio|all", "all")
  .option("--provider <provider>", "Provider: pexels|pixabay|unsplash|wikimedia|all", "all")
  .option("--limit <n>", "Max results per provider", "10")
  .addHelpText(
    "after",
    `
Examples:
  $ media-ingester search "mountain lake" --type image
  $ media-ingester search "thunder" --type audio --provider wikimedia --limit 5
`,
  )
  .action(async (query: string, options: SearchOptions): Promise<void> => {
    await runSearchCommand(query, options)
  })

program
  .command("get <query>")
  .description("Search and download stock media with tag sidecars + manifest")
  .option("--type <type>", "Media type: image|video|audio|all", "all")
  .option("--provider <provider>", "Provider: pexels|pixabay|unsplash|wikimedia|all", "all")
  .option("--limit <n>", "Max results to search", "10")
  .option("--download-top <n>", "Download top N results", "3")
  .option("--out <dir>", "Output directory", "./assets")
  .option("--api", "Enable API enrichment")
  .option("--api-key <key>", "API key for enrichment")
  .option("--api-base-url <url>", "API base URL for enrichment")
  .option("--api-model <model>", "API model for enrichment")
  .option(
    "--categorize",
    "Categorize provider tags with a text LLM (no media uploaded); implied by --api",
  )
  .option("--force", "Overwrite existing files")
  .option("--dry-run", "Print plan; no assets, but provider API caches may update")
  .option("-o, --output <path>", "Manifest output path")
  .addHelpText(
    "after",
    `
Examples:
  $ media-ingester get "mountain lake" --type image --download-top 3 --out ./assets
  $ media-ingester get "rain ambience" --type audio --api --api-model gpt-5-mini
  $ media-ingester get "city timelapse" --dry-run

Notes:
  --api sends sampled frames/clips (never full media) to an OpenAI-compatible endpoint; requires ffmpeg for video/audio.
  --categorize sends only tags/metadata (never media) to the text-tier endpoint; --api includes it automatically.
  --dry-run prints the plan without downloading or writing sidecars/manifests.
`,
  )
  .action(async (query: string, options: GetOptions): Promise<void> => {
    await runGetCommand(query, options)
  })

await main()

async function main(): Promise<void> {
  // no-excuse-ok: catch
  try {
    await program.parseAsync()
  } catch (error) {
    process.exitCode = 1
    console.error(error instanceof Error ? error.message : "command failed")
  }
}
