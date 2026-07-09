# media-ingester

Hybrid LLM skill repo plus Bun CLI backend for searching and downloading stock media from Pexels and Wikimedia Commons.

## What this is

- LLM skill entrypoint: `SKILL.md`
- CLI backend: `src/cli.ts`
- Offline-first: downloads and writes sidecars without any API calls by default
- Optional AI enrichment: tags, descriptions, and quality scores when `--api` is passed

## Prerequisites

- [Bun](https://bun.sh) v1.3+
- [ffmpeg](https://ffmpeg.org) (required for video `--api` enrichment; not needed for search or plain downloads)

## Install

```sh
bun install
```

## Setup

```sh
cp .env.sample .env
# edit .env and set PEXELS_API_KEY
```

Get a free Pexels API key at https://www.pexels.com/api/. Wikimedia Commons needs no key.

## Skill usage

Agents should load this skill when searching stock photos/videos for projects, downloading media with rich metadata sidecars, or writing manifests compatible with media-tagger v1.1.

## CLI

Show help:

```sh
bun run src/cli.ts --help
```

Search without downloading:

```sh
bun run src/cli.ts search "sunset beach" --type video --provider pexels --limit 5
```

Download top result:

```sh
bun run src/cli.ts get "colorful canopy bridge" --type image --provider pexels --download-top 1 --out ./assets
```

Download with AI tagging:

```sh
bun run src/cli.ts get "beach sunset" --type video --download-top 2 --out ./assets --api
```

Dry run (prints plan, no downloads):

```sh
bun run src/cli.ts get "colorful canopy bridge" --dry-run
```

Wikimedia Commons (no API key needed):

```sh
bun run src/cli.ts get "blue bridge" --provider wikimedia --download-top 2 --out ./assets
```

## API configuration

Copy `.env.sample` to `.env` and set `MEDIA_INGEST_API_KEY`, or pass `--api-key`. `MEDIA_INGEST_BASE_URL` and `MEDIA_INGEST_MODEL` set the default endpoint and model.

Optional flags: `--api-base-url`, `--api-model`.

### Audio overrides

Audio enrichment needs an audio-capable model. When the default model cannot hear audio, set `MEDIA_INGEST_AUDIO_BASE_URL`, `MEDIA_INGEST_AUDIO_MODEL`, and/or `MEDIA_INGEST_AUDIO_API_KEY` to route audio requests elsewhere. Each falls back to its non-audio counterpart when unset.

## Offline vs API mode

Offline mode downloads files and writes hashes, technical metadata, sidecars, and manifests. AI summaries, tags, and quality scores stay empty.

API mode sends selected evidence to the configured provider and fills AI-generated fields when the response validates.

## Video enrichment

The CLI samples JPEG frames from video with ffmpeg and sends those frames to the VLM. It does not upload the full video file.

## Privacy

Do not enable `--api` for private, sensitive, or confidential media. Offline mode stays local.

## Output files

Per downloaded asset:

- `<filename>` — the media file itself
- `<filename>.media.json` — sidecar with metadata, tags, credits, and license info (media-tagger v1.1 schema)
- `<name>.external.raw.json` — raw API response from the provider
- `media_manifest.jsonl` — one JSON line per asset, appended on each run

## Schema

Sidecars use `schema_version: "1.1"`, compatible with media-tagger v1.1. Fields include `source.origin`, `source.credits`, `source.license`, `tags`, `description`, and technical metadata.

## Rights & Attribution

Verify the license before publishing. Pexels requires a link to the photographer and to pexels.com. Wikimedia Commons licenses vary per file; check `source.license` in the sidecar.
