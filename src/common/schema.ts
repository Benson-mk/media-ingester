import { z } from "zod"

const JsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
const JsonishSchema = z.union([
  JsonPrimitiveSchema,
  z.array(JsonPrimitiveSchema),
  z.record(z.string(), JsonPrimitiveSchema),
])

const StringListSchema = z.array(z.string())

export const ImageMetaSchema = z.object({
  composition: z.object({
    shot_type: z.string(),
    main_subject: z.string(),
    background: z.string(),
    text_space: z.string(),
    usable_crops: StringListSchema,
  }),
  detected_text: StringListSchema,
  thumbnail_usefulness: z.string(),
})

export const VideoMetaSchema = z.object({
  sampling: z.object({
    interval_seconds: z.number(),
    frames: z.array(
      z.object({
        time_seconds: z.number(),
        path: z.string(),
      }),
    ),
  }),
  segments: z.array(
    z.object({
      start_seconds: z.number(),
      end_seconds: z.number(),
      caption: z.string(),
      tags: StringListSchema,
      shot_type: z.string(),
      camera_motion: z.string(),
      motion_level: z.string(),
      recommended_use: StringListSchema,
      quality_score: z.number(),
    }),
  ),
})

export const BgmMetaSchema = z.object({
  music_type: z.string(),
  genre: StringListSchema,
  mood: StringListSchema,
  energy: z.string(),
  tempo: z.object({
    bpm: z.number(),
    confidence: z.number(),
  }),
  key: z.object({
    value: z.string(),
    confidence: z.number(),
  }),
  structure: z.object({
    has_intro: z.boolean(),
    has_outro: z.boolean(),
    loopable: z.boolean(),
  }),
  voiceover: z.object({
    vocal_presence: z.string(),
    safe_for_voiceover: z.boolean(),
  }),
  editing_use: StringListSchema,
  avoid_use: StringListSchema,
})

export const ExternalBlockSchema = z.object({
  provider: z.string(),
  source_id: z.string(),
  source_url: z.string(),
  download_url: z.string(),
  creator: z.object({
    name: z.string(),
    profile_url: z.string(),
  }),
  license: z.string(),
  license_url: z.string(),
  credits: z.object({
    required: z.boolean(),
    text: z.string(),
  }),
  raw_metadata_path: z.string(),
  exif: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  location: z.string().optional(),
})

export const InternalBlockSchema = z.object({
  origin: z.string(),
})

export const MediaSidecarSchema = z.object({
  schema_version: z.enum(["1.0", "1.1"]).default("1.1"),
  asset_id: z.string(),
  source_file: z.string(),
  media_type: z.union([z.literal("image"), z.literal("video"), z.literal("audio")]),
  created_at: z.string(),
  updated_at: z.string(),
  technical: z.record(z.string(), JsonishSchema),
  summary: z.object({
    title: z.string(),
    short_caption: z.string(),
    detailed_caption: z.string(),
    best_use: StringListSchema,
    not_recommended_for: StringListSchema,
  }),
  tags: z.object({
    core: StringListSchema,
    visual: StringListSchema,
    audio: StringListSchema,
    mood: StringListSchema,
    style: StringListSchema,
    editing: StringListSchema,
    project: StringListSchema,
  }),
  quality: z.object({
    overall_score: z.number(),
    reuse_score: z.number(),
  }),
  rights: z.object({
    owner: z.string(),
    source: z.string(),
    license: z.string(),
    notes: z.string(),
  }),
  api_usage: z.object({
    provider: z.string(),
    model: z.string(),
    media_uploaded_to_api: z.boolean(),
  }),
  image: ImageMetaSchema.optional(),
  video: VideoMetaSchema.optional(),
  bgm: BgmMetaSchema.optional(),
  external: ExternalBlockSchema.optional(),
  internal: InternalBlockSchema.optional(),
})

export type ImageMeta = z.infer<typeof ImageMetaSchema>
export type VideoMeta = z.infer<typeof VideoMetaSchema>
export type BgmMeta = z.infer<typeof BgmMetaSchema>
export type ExternalBlock = z.infer<typeof ExternalBlockSchema>
export type InternalBlock = z.infer<typeof InternalBlockSchema>
export type MediaSidecar = z.infer<typeof MediaSidecarSchema>
