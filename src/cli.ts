import { Command } from "commander"

import { type GetOptions, runGetCommand } from "./commands/get"
import { runSearchCommand, type SearchOptions } from "./commands/search"

const program = new Command()

program
  .name("media-ingester")
  .version("0.1.0")
  .description("Search and download stock media from Pexels and Wikimedia")

program
  .command("search <query>")
  .description("Search stock media providers")
  .option("--type <type>", "Media type: image|video|audio|all", "all")
  .option("--provider <provider>", "Provider: pexels|wikimedia|all", "all")
  .option("--limit <n>", "Max results per provider", "10")
  .action(async (query: string, options: SearchOptions): Promise<void> => {
    await runSearchCommand(query, options)
  })

program
  .command("get <query>")
  .description("Search and download stock media")
  .option("--type <type>", "Media type: image|video|audio|all", "all")
  .option("--provider <provider>", "Provider: pexels|wikimedia|all", "all")
  .option("--limit <n>", "Max results to search", "10")
  .option("--download-top <n>", "Download top N results", "3")
  .option("--out <dir>", "Output directory", "./assets")
  .option("--api", "Enable API enrichment")
  .option("--api-key <key>", "API key for enrichment")
  .option("--api-base-url <url>", "API base URL for enrichment")
  .option("--api-model <model>", "API model for enrichment")
  .option("--force", "Overwrite existing files")
  .option("--dry-run", "Print plan without downloading")
  .option("-o, --output <path>", "Manifest output path")
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
