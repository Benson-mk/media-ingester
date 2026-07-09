---
name: media-ingester
description: Search and download stock media from Pexels and Wikimedia Commons, writing .media.json sidecars and manifest entries in media-tagger v1.1 format.
---

# media-ingester

## Overview

Stock media search and download skill. Use the Bun CLI backend in this repo to find and fetch images and videos from Pexels and Wikimedia Commons, with optional AI enrichment (tags, description, quality scores) via an OpenAI-compatible API.

Default is offline. API enrichment only happens when `--api` is passed.

## When to Use

- search stock photos or videos for a video project
- download media with rich metadata sidecars (tags, camera, location, license)
- fetch Pexels or Wikimedia Commons assets into a local folder
- write `.media.json` sidecars and `media_manifest.jsonl` entries compatible with media-tagger v1.1

## When Not to Use

- arbitrary URL downloads (not supported)
- YouTube, social media, or other platforms (only Pexels + Wikimedia Commons)
- Pixabay, Unsplash, or other providers (not implemented)
- database-backed asset management or DAM workflows

## Quick Commands

```sh
bun install
bun run src/cli.ts --help

# Search without downloading
bun run src/cli.ts search "sunset beach" --type video --provider pexels --limit 5

# Download top result
bun run src/cli.ts get "colorful canopy bridge" --type image --provider pexels --download-top 1 --out ./assets

# Download with AI tagging
bun run src/cli.ts get "beach sunset" --type video --download-top 2 --out ./assets --api

# Dry run (prints plan, no downloads)
bun run src/cli.ts get "colorful canopy bridge" --dry-run

# Wikimedia Commons (no API key needed)
bun run src/cli.ts get "blue bridge" --provider wikimedia --download-top 2 --out ./assets
```

## API Configuration

Set `MEDIA_INGEST_API_KEY` in `.env` or pass `--api-key`. Configure the endpoint and model via `MEDIA_INGEST_BASE_URL`/`MEDIA_INGEST_MODEL` env vars or `--api-base-url`/`--api-model` flags (flags win).

Video enrichment requires ffmpeg to extract frames. Audio enrichment needs an audio-capable model; override routing with `MEDIA_INGEST_AUDIO_BASE_URL`/`MEDIA_INGEST_AUDIO_MODEL`/`MEDIA_INGEST_AUDIO_API_KEY`. Each falls back to its non-audio counterpart when unset.

## Rights & Attribution

- Verify the license before publishing any downloaded asset. Pexels licenses allow free use with attribution; Wikimedia Commons licenses vary per file.
- `external.credits` in each sidecar contains the photographer name and source URL.
- Pexels requires a link to the photographer and to pexels.com when publishing.
- Tags from Wikimedia are scraped from page JSON-LD; that source may change or be absent.

## Privacy

`--api` mode uploads evidence to the configured provider: sampled JPEG frames for video (not the full file) and 30-second clips for audio (not the full file). Images are sent as-is. Do not enable `--api` for private or confidential media.

Offline mode (`--dry-run` or no `--api`) stays local.

## Common Mistakes

1. Missing `PEXELS_API_KEY` — Pexels provider errors or returns nothing; Wikimedia still works.
2. Expecting AI tags on Wikimedia without `--api` — the API returns no tags; pass `--api` to enrich.
3. Video `--api` without ffmpeg installed — frame extraction fails; install ffmpeg first.
4. Pexels API search returns no tags — tags come from page JSON-LD scraped during `get`, not from the search API.
