# PROJECT KNOWLEDGE BASE

**Generated:** 2026-07-14 | **Commit:** 5f8dcc7 | **Branch:** main

## OVERVIEW

Bun/TypeScript CLI + LLM skill repo (`SKILL.md`) that searches and downloads stock media from Pexels/Pixabay/Unsplash/Wikimedia and writes tag sidecars (`<name>.media.json`, schema v1.1) plus a `media_manifest.jsonl`. Provider search/download always hits the network; `--api` additionally sends evidence to an OpenAI-compatible VLM/audio endpoint.

**Sister project:** [Benson-mk/media-tagger](https://github.com/Benson-mk/media-tagger) — the *consumer/tagger* (local-first scanner that tags existing media libraries). This repo is the *producer*. Same stack (Bun, commander, zod, exifr, biome), same sidecar schema, same `src/common/paths.ts` conventions. **Schema changes here must stay compatible with media-tagger v1.1.**

## STRUCTURE

```
src/
├── cli.ts             # ONLY entry point (commander; no main/index/server)
├── commands/          # search.ts, get.ts (main pipeline), resolveProviders.ts (env-key gating)
├── providers/         # Pexels/Pixabay/Unsplash/Wikimedia adapters (see providers/AGENTS.md)
├── download/          # downloadAsset + buildSidecar (sidecar assembly)
├── tagging/           # AI enrichment: enrichSidecar, prompts, ffmpeg frame/clip sampling
├── llm/               # OpenAI-compatible chat clients (vlmClient, audioClient)
├── crawl/             # provider webpage extraction (Pexels JSON-LD, Pixabay __BOOTSTRAP__)
├── metadata/          # EXIF (exifr) + Pixabay metadata promotion
├── common/            # schema.ts (MediaSidecar = the v1.1 contract), io, logger, paths
└── __tests__/         # CLI-level integration tests only
```

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Add/modify CLI flags | `src/cli.ts` → `src/commands/{search,get}.ts` |
| Download/sidecar pipeline | `src/commands/get.ts` (orchestrates all steps) |
| Provider behavior/quirks | `src/providers/` + its AGENTS.md |
| Sidecar shape / schema changes | `src/common/schema.ts` — must stay media-tagger v1.1 compatible |
| AI enrichment / model tiers | `src/tagging/enrichSidecar.ts` (LLM/VLM/Audio tier fallback) |
| Provider key gating | `src/commands/resolveProviders.ts` |
| Pixabay cache behavior | `.media_cache/pixabay`, logic in providers/crawl |

## CODE MAP

| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| `Provider` | interface | src/providers/types.ts:27 | 11 | contract all adapters implement |
| `ProviderItem` | type | src/providers/types.ts:1 | high | normalized search hit |
| `MediaSidecar` | schema | src/common/schema.ts | high | v1.1 sidecar contract (shared with media-tagger) |
| `runGetCommand` | fn | src/commands/get.ts | cli | download→details→crawl→sidecar→enrich→write |
| `enrichSidecar` | fn | src/tagging/enrichSidecar.ts:283 | 2 | AI enrichment dispatch by media_type |
| `requestStructuredChatCompletion` | fn | src/llm/vlmClient.ts:85 | 16 | core LLM call, zod-validated JSON |
| `buildSidecar` | fn | src/download/buildSidecar.ts | get | merges API + JSON-LD + bootstrap metadata |

## CONVENTIONS

- Strict-TS hard mode: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`. `tsc --noEmit`; Bun does the build.
- Biome: no default exports, no `any`, no non-null assertions, `import type` required, 100 cols, double quotes, semicolons as-needed.
- Tests: colocated `*.test.ts` via `bun:test`; CLI integration tests in `src/__tests__/`; fixtures in `src/crawl/__fixtures__/`. `global.fetch` mocked, env saved/restored in `beforeEach`/`afterEach`, `process.exitCode` asserted (never process crash).
- Blank env key = missing key.
- Provider order deterministic: pexels, pixabay, unsplash, wikimedia.

## ANTI-PATTERNS (THIS PROJECT)

- `enrichSidecar` NEVER modifies `source`, `rights`, `asset_id`. API failure is non-fatal: log, return sidecar as-is with `api_usage` populated.
- NEVER break media-tagger v1.1 sidecar compatibility (`schema_version: "1.1"`); don't clobber existing `.media.json` / `media_manifest.jsonl` layouts.
- NEVER send full media files to AI endpoints — video = sampled JPEG frames, audio = extracted clip only.
- NEVER put API keys in cache filenames, source, or command output. Cache names are hashed.
- Dry run must not fetch provider webpages or write assets/sidecars/manifests (Pixabay API response cache is the one allowed write).

## COMMANDS

```bash
bun install
bun run src/cli.ts --help        # dev
bun run check                    # biome + tsc — run before shipping
bun test                         # no package.json test script; use bun test directly
bun run build                    # bun build → dist/
```

Requires ffmpeg for video/audio `--api` enrichment only.

## NOTES

- `--api` (AI enrichment) is opt-in; provider search/download hits network regardless.
- `--provider all` skips keyed providers missing keys (warn); explicitly selecting one without key errors.
- Model tiers: `MEDIA_INGEST_` (text) ← `MEDIA_INGEST_VLM_` (image/video) ← `MEDIA_INGEST_AUDIO_` (audio); unset fields inherit down-chain.
- `.scratch/`, `CONTEXT.md`, `docs/adr/` referenced below don't exist yet — proceed silently if absent (per docs/agents/domain.md).

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.
