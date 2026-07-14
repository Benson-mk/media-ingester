# PROVIDERS

Adapters implementing `Provider` (types.ts). Each normalizes API hits into `ProviderItem` and keeps the full payload in `raw`.

## WHERE TO LOOK

| Provider | File | Quirks |
|----------|------|--------|
| Pexels | pexels.ts | image+video; JSON-LD page enrichment lives in `src/crawl/extractPexelsJsonLd.ts` |
| Pixabay | pixabay.ts | image+video; 24h API cache in `.media_cache/pixabay` (failures cached 1h); page `__BOOTSTRAP__` enrichment in `src/crawl/pixabayBootstrap.ts` is undocumented/best-effort — 403 warns, never fails |
| Unsplash | unsplash.ts | image ONLY; `getDetails` hydrates full-photo API; `trackDownload` REQUIRED before fetching `urls.full`; license fields static (API returns none) |
| Wikimedia | wikimedia.ts | keyless; license varies per file — read from API, never assume |

## CONVENTIONS

- New provider: implement `Provider` (`search` required; `getDetails`/`trackDownload` optional), register in `src/commands/resolveProviders.ts`, append to deterministic order.
- Key gating happens in resolveProviders, NOT in adapters. Blank env var = missing key.
- Tests colocated, `global.fetch` mocked — adapters never hit network in tests.

## ANTI-PATTERNS

- NEVER fetch asset webpages during `search` or dry run — page enrichment is a real-`get`-only step.
- NEVER put API keys in URLs that get cached/logged; Pixabay cache filenames are hashed for this reason.
- NEVER skip Unsplash download tracking for new/forced downloads (API terms).
