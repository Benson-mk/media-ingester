export type ProviderItem = {
  provider: string
  source_id: string
  media_type: "image" | "video" | "audio"
  title: string
  description: string
  source_url: string
  download_url: string
  thumbnail_url?: string
  width?: number
  height?: number
  duration_seconds?: number
  creator: { name: string; profile_url: string }
  license: string
  license_url: string
  api_tags: string[]
  raw: unknown
}

export type MediaTypeFilter = "image" | "video" | "audio" | "all"

export interface Provider {
  id: string
  supported: ReadonlyArray<"image" | "video" | "audio">
  search(q: string, type: MediaTypeFilter, limit: number): Promise<ProviderItem[]>
}
