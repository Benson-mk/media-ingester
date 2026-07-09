import { Command } from "commander"

const program = new Command()
program
  .name("media-ingester")
  .version("0.1.0")
  .description("Search and download stock media from Pexels and Wikimedia")
program.parse()
