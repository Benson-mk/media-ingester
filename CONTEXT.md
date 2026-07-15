# Media Ingester

Stock media search, download, and tag organization pipeline. Producers find assets from provider APIs, enrich metadata, and write sidecars consumed by downstream taggers.

## Language

**Core tags**
Subject and content tags that describe what an asset depicts: people, objects, places, events. Before a categorization pass, core holds all provider-supplied tags as ingested. After a pass, core retains only subject tags plus any tag that could not be classified into a facet bucket. Nothing is ever dropped from core — unclassifiable tags remain here as a fallback.
_Avoid_: raw tags, default tags, base tags

**Categorization pass**
A text-only AI step that redistributes provider-supplied tags out of core and into semantic facet buckets, and fills in missing title and short caption from provider metadata. The pass never sees the media itself — only tags and descriptive text. Available standalone and runs automatically as a prerequisite when full enrichment is enabled. Failure is non-fatal: tags stay in core and the pipeline continues.
_Avoid_: classification step, tagging pass, LLM pass

**Enrichment**
The full AI analysis layer that sends media evidence (sampled frames for video, a short clip for audio, the image itself for photos) to a vision or audio model and produces tags, captions, quality scores, and media-specific metadata. Distinct from the categorization pass, which is text-only. Must be enabled explicitly.
_Avoid_: AI tagging, annotation, VLM pass

**Facet buckets**
The semantic tag categories beyond core: visual (how the asset looks), mood (emotional tone), style (aesthetic), editing (post-production use), audio (sound characteristics). A tag may appear in multiple buckets when applicable; each bucket is deduplicated independently.
_Avoid_: tag categories, tag groups, tag slots

**Provider ground truth**
The original, unmodified provider API response stored alongside the sidecar. When tags are redistributed by the categorization pass, this raw record remains the authoritative source of what the provider originally supplied, enabling recovery or reprocessing.
_Avoid_: raw response, API response, original payload
