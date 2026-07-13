---
name: media-ingester
description: Search and download stock media from Pexels, Pixabay, Unsplash, and Wikimedia Commons, writing .media.json sidecars and manifest entries in media-tagger v1.1 format.
---

# media-ingester

## Overview

Stock media search and download skill. Use the Bun CLI backend in this repo to find and fetch images and videos from Pexels and Pixabay, images from Unsplash, and media from Wikimedia Commons, with optional AI enrichment (tags, description, quality scores) via an OpenAI-compatible API.

AI enrichment only happens when `--api` is passed. Provider searches and downloads still contact the selected stock-media APIs.

## When to Use

- search stock photos or videos for a video project
- download media with rich metadata sidecars (tags, camera, location, license)
- fetch Pexels, Pixabay, Unsplash, or Wikimedia Commons assets into a local folder
- write `.media.json` sidecars and `media_manifest.jsonl` entries compatible with media-tagger v1.1

## When Not to Use

- arbitrary URL downloads (not supported)
- YouTube, social media, or other platforms (only Pexels, Pixabay, Unsplash, and Wikimedia Commons)
- other stock-media providers (not implemented)
- database-backed asset management or DAM workflows

## Quick Commands

```sh
bun install
bun run src/cli.ts --help

# Search without downloading
bun run src/cli.ts search "sunset beach" --type video --provider pexels --limit 5

# Download top result
bun run src/cli.ts get "colorful canopy bridge" --type image --provider pexels --download-top 1 --out ./assets

# Pixabay images or videos
bun run src/cli.ts get "winter mountain lake" --provider pixabay --download-top 1 --out ./assets

# Download with AI tagging
bun run src/cli.ts get "beach sunset" --type video --download-top 2 --out ./assets --api

# Dry run (prints plan, no downloads)
bun run src/cli.ts get "colorful canopy bridge" --dry-run

# Wikimedia Commons (no API key needed)
bun run src/cli.ts get "blue bridge" --provider wikimedia --download-top 2 --out ./assets

# Unsplash (images only)
bun run src/cli.ts get "hong kong skyline" --type image --provider unsplash --download-top 2 --out ./assets
```

## Provider Configuration

Set `PEXELS_API_KEY` for Pexels, `PIXABAY_API_KEY` for Pixabay, and `UNSPLASH_ACCESS_KEY` for Unsplash. Wikimedia Commons is keyless. With `--provider all`, providers whose keys are blank or missing are skipped independently with a warning; explicitly selecting a keyed provider without its key is an error. Provider priority is Pexels, Pixabay, Unsplash, then Wikimedia.

Pixabay searches images and videos through the official API. `search` never fetches asset webpages. During a real `get`, the CLI performs best-effort enrichment of each selected Pixabay item from the page's undocumented `window.__BOOTSTRAP__` payload. This can add EXIF, publication, rendition, contributor, and descriptive metadata. A changed payload or HTTP 403 produces a warning and continues with API metadata; the CLI does not bypass access controls or download from webpage links. Use this enrichment consistently with [Pixabay's Terms of Service](https://pixabay.com/service/terms/).

The complete selected API hit is retained under `source.raw.api`. On successful page enrichment, only the matching `page.mediaItem` is retained under `source.raw.bootstrap`; unrelated request/session, experiment, ad, recommendation, and bot-score data is discarded. Both raw blocks are embedded in the asset's single `.media.json` sidecar; no duplicate raw-metadata file is written. Normalized fields are exposed under `source.provider_metadata`, while API engagement values remain authoritative.

Pixabay API responses and successful website metadata are cached under `.media_cache/pixabay` for 24 hours; failed website attempts are cached for one hour. `--force` does not bypass these caches. `--dry-run` does not crawl Pixabay pages or write asset outputs, but the API search may update the Pixabay response cache.

Unsplash supports images only. For selected items requiring a new or forced download, `get` hydrates the summary result from the full-photo API, triggers the required download event, then fetches `urls.full`. This retains available descriptions, tags, EXIF, location, and attribution data. Search, `--dry-run`, and skip-existing paths do not fetch detail or trigger a download event. Static Unsplash License fields are supplied because the API does not return a license field.

## AI Enrichment Configuration

Set `MEDIA_INGEST_API_KEY` in `.env` or pass `--api-key`. Configure the default endpoint and model via `MEDIA_INGEST_BASE_URL`/`MEDIA_INGEST_MODEL` or `--api-base-url`/`--api-model` flags (flags win).

Three routing tiers: `MEDIA_INGEST_*` (base LLM, handles everything by default), `MEDIA_INGEST_VLM_*` (image/video; fallback: LLM), `MEDIA_INGEST_AUDIO_*` (audio; fallback: VLM → LLM). A tier is active when any of its variables is set; unset fields inherit from the tier below. Video enrichment requires ffmpeg to extract frames.

## Rights & Attribution

- Verify the license before publishing any downloaded asset. Pexels and Unsplash have provider licenses, Pixabay uses the [Pixabay Content License](https://pixabay.com/service/license-summary/), and Wikimedia Commons licenses vary per file.
- `source.credits` and `source.creator` in each sidecar contain the required credit text, photographer identity, and attribution links.
- Pexels requires a link to the photographer and to pexels.com when publishing.
- Unsplash API integrations must attribute both the photographer and Unsplash, with referral parameters on the attribution links. API attribution and download-tracking requirements apply even though the Unsplash License itself does not generally require credit.

## Privacy

`--api` mode uploads evidence to the configured provider: sampled JPEG frames for video (not the full file) and 30-second clips for audio (not the full file). Images are sent as-is. Do not enable `--api` for private or confidential media.

Without `--api`, media is not uploaded to an AI service. Provider search, detail, asset-download, Pixabay website-enrichment, and required Unsplash download-tracking requests still contact the relevant provider.

## Common Mistakes

1. Missing `PEXELS_API_KEY`, `PIXABAY_API_KEY`, or `UNSPLASH_ACCESS_KEY` — an explicitly selected keyed provider errors; `--provider all` warns and continues with available providers.
2. Treating Pixabay website metadata as guaranteed — bootstrap enrichment is best-effort and a 403 falls back to API metadata.
3. Requesting Unsplash video or audio — Unsplash support is image-only.
4. Expecting AI tags on Wikimedia without `--api` — the API returns no tags; pass `--api` to enrich.
5. Video `--api` without ffmpeg installed — frame extraction fails; install ffmpeg first.
6. Pexels API search returns no tags — tags come from page JSON-LD fetched during `get`, not from the search API.
