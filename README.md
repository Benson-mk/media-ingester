# media-ingester

Hybrid LLM skill repo plus Bun CLI backend for searching and downloading stock media from Pexels, Pixabay, Unsplash, and Wikimedia Commons.

## What this is

- LLM skill entrypoint: `SKILL.md`
- CLI backend: `src/cli.ts`
- AI enrichment is opt-in; provider searches and downloads still contact the selected stock-media APIs
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
# edit .env and set PEXELS_API_KEY, PIXABAY_API_KEY, and/or UNSPLASH_ACCESS_KEY
```

Create a [Pexels API key](https://www.pexels.com/api/), a [Pixabay API key](https://pixabay.com/api/docs/), or an [Unsplash application access key](https://unsplash.com/oauth/applications). Wikimedia Commons needs no key. When `--provider all` is used, keyed providers with missing keys are skipped independently with a warning; explicitly selecting one without its key reports an error.

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

Pixabay image or video:

```sh
bun run src/cli.ts get "winter mountain lake" --provider pixabay --download-top 1 --out ./assets
```

Download with AI tagging:

```sh
bun run src/cli.ts get "beach sunset" --type video --download-top 2 --out ./assets --api
```

Dry run (prints plan, no downloads):

```sh
bun run src/cli.ts get "colorful canopy bridge" --dry-run
```

A dry run does not fetch provider webpages or write assets, sidecars, or manifests. Pixabay API search responses can still be written to its required response cache.

Wikimedia Commons (no API key needed):

```sh
bun run src/cli.ts get "blue bridge" --provider wikimedia --download-top 2 --out ./assets
```

Unsplash images:

```sh
bun run src/cli.ts get "hong kong skyline" --type image --provider unsplash --download-top 2 --out ./assets
```

Unsplash supports images only. For each selected item requiring a new or forced download, `get` hydrates the summary result from the full-photo API, triggers the required download event, then fetches `urls.full`. This retains available descriptions, tags, EXIF, location, and attribution metadata. Searches, dry runs, and skipped existing files do not fetch detail or trigger a download event. The Unsplash License fields are supplied statically because the API does not return a license field.

Pixabay supports image and video search through its official API. `search` never fetches asset webpages. During a real `get`, the selected asset page is fetched once for best-effort enrichment from `window.__BOOTSTRAP__`, adding available EXIF, publication, rendition, contributor, and descriptive metadata to the sidecar. This website payload is undocumented and may change or return HTTP 403; either case produces a warning and the download continues with API metadata. The CLI does not bypass access controls and always downloads the asset from an API-provided URL.

The complete selected API hit is retained under `source.raw.api`. When website enrichment succeeds, only the ID-matched `page.mediaItem` is retained under `source.raw.bootstrap`; request/session data, experiments, ads, recommendations, and bot scores are discarded. Promoted fields live under `source.provider_metadata`, with API engagement counts kept authoritative.

Successful Pixabay API responses and website metadata are cached under `.media_cache/pixabay` for 24 hours. Failed or blocked website enrichment attempts are cached for one hour to avoid repeatedly contacting the page. Cache filenames are hashed and never contain the API key or keyed request URL. `--force` controls asset replacement and does not bypass these provider caches.

## Provider API configuration

- `PEXELS_API_KEY` enables Pexels image and video search.
- `PIXABAY_API_KEY` enables Pixabay image and video search.
- `UNSPLASH_ACCESS_KEY` enables Unsplash image search and download tracking.
- Wikimedia Commons is keyless.

Provider credentials are independent of the AI-enrichment credentials below. Keep access keys private and do not place them in source code or command output.

## AI enrichment configuration

Copy `.env.sample` to `.env` and set `MEDIA_INGEST_API_KEY`, or pass `--api-key`. `MEDIA_INGEST_BASE_URL` and `MEDIA_INGEST_MODEL` set the default endpoint and model for all calls.

Optional flags: `--api-base-url`, `--api-model` (feed the base tier).

### Model tiers

Three tiers, each with `_API_KEY`, `_BASE_URL`, and `_MODEL` variants. A tier is active when any of its variables is set. An active tier declares that endpoint/model handles that media type; unset fields inherit from the next tier down.

| Tier | Env prefix | Handles | Fallback |
|---|---|---|---|
| Base LLM | `MEDIA_INGEST_` | text (all by default) | — |
| VLM | `MEDIA_INGEST_VLM_` | image + video | Base LLM |
| Audio | `MEDIA_INGEST_AUDIO_` | audio | VLM → Base LLM |

### Tag categorization

`--categorize` runs a text-only AI step that redistributes provider-supplied tags from the "core" bucket into semantic groups (visual, mood, style, editing, audio) and fills empty title and short caption from provider metadata. No media file is uploaded — only tags and metadata are sent to the text-tier endpoint, so `media_uploaded_to_api` stays `false` in the sidecar.

`--api` includes the categorization pass automatically as a prerequisite step.

The categorization pass uses the base `MEDIA_INGEST_` model tier — its primary purpose. If a call fails, the download and sidecar are still written with tags left in core (non-fatal).

Example:

```sh
bun run src/cli.ts get "beach sunset" --download-top 1 --out ./assets --categorize
```

Fallback chains: image/video = `VLM ?? LLM`; audio = `AUDIO ?? VLM ?? LLM`.

**Examples:**
- Only `MEDIA_INGEST_*` set → one model handles everything.
- `MEDIA_INGEST_*` + `MEDIA_INGEST_VLM_*` → VLM handles image/video and audio; LLM handles text.
- All three tiers set → each handles its declared media type.

## Without vs with AI enrichment

Without `--api`, the CLI still contacts the selected stock-media provider to search and download, then writes hashes, technical metadata, provider-supplied tags, sidecars, and manifests. It does not send the media to an AI enrichment service, so only AI-generated summaries, tags, and quality scores stay empty.

With `--categorize` only (no `--api`), tags are reorganized into facet buckets and missing title/short caption are filled from provider metadata — no media is uploaded to an AI service.

API mode sends selected evidence to the configured provider and fills AI-generated fields when the response validates.

## Video enrichment

The CLI samples JPEG frames from video with ffmpeg and sends those frames to the VLM. It does not upload the full video file.

## Privacy

Do not enable `--api` for private, sensitive, or confidential media. `--categorize` sends only provider tags and descriptive metadata to the text-tier endpoint; media files are never uploaded in categorize-only mode. Without `--api`, media is not sent to an AI service, but normal provider search, detail, asset-download, Pixabay website-enrichment, and required Unsplash download-tracking requests still occur.

## Output files

Per downloaded asset:

- `<filename>` — the media file itself
- `<filename>.media.json` — the single metadata sidecar, including tags, credits, license info, and complete provider payloads under `source.raw` (media-tagger v1.1 schema)
- `media_manifest.jsonl` — one JSON line per asset, appended on each run

## Schema

Sidecars use `schema_version: "1.1"`, compatible with media-tagger v1.1. Fields include `source.origin`, `source.credits`, `source.license`, `tags`, `description`, and technical metadata.

## Rights & Attribution

Verify the license before publishing. Pexels requires a link to the photographer and to pexels.com. Pixabay assets are governed by the [Pixabay Content License](https://pixabay.com/service/license-summary/); website enrichment is undocumented and must be used consistently with [Pixabay's Terms of Service](https://pixabay.com/service/terms/). Wikimedia Commons licenses vary per file; check `source.license` in the sidecar.

Unsplash API integrations must attribute both the photographer and Unsplash, with referral parameters on the attribution links. The sidecar records the creator profile, source URL, static license fields, and required credit text. The Unsplash License and API integration rules are distinct: even where the license itself does not require credit, applications using the API must follow the API attribution and download-tracking guidelines.
