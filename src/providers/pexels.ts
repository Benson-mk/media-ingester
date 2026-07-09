import type { MediaTypeFilter, Provider, ProviderItem } from "./types"

const PEXELS_PHOTO_URL = "https://api.pexels.com/v1/search"
const PEXELS_VIDEO_URL = "https://api.pexels.com/v1/videos/search"
const LICENSE = "pexels"
const LICENSE_URL = "https://www.pexels.com/license/"
const RATE_LIMIT_MS = 500

let lastPexelsCall = 0

export function resetPexelsRateLimit(): void {
  lastPexelsCall = 0
}

type PexelsPhotoSrc = {
  original?: string
  medium?: string
}

type PexelsPhoto = {
  id: number
  width: number
  height: number
  url: string
  alt: string
  photographer: string
  photographer_url: string
  src: PexelsPhotoSrc
}

type PexelsPhotoResponse = {
  photos: PexelsPhoto[]
}

type PexelsVideoFile = {
  quality: string
  file_type: string
  width: number
  height: number
  fps: number
  link: string
}

type PexelsVideoUser = {
  name: string
  url: string
}

type PexelsVideo = {
  id: number
  width: number
  height: number
  url: string
  image: string
  duration: number
  user: PexelsVideoUser
  video_files: PexelsVideoFile[]
}

type PexelsVideoResponse = {
  videos: PexelsVideo[]
}

function requireApiKey(): string {
  const { PEXELS_API_KEY: key } = process.env
  if (!key) {
    throw new Error("PEXELS_API_KEY required for Pexels provider")
  }
  return key
}

async function throttle(): Promise<void> {
  const elapsed = Date.now() - lastPexelsCall
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MS - elapsed))
  }
}

async function pexelsFetch(url: string, apiKey: string): Promise<unknown> {
  await throttle()
  const response = await fetch(url, { headers: { authorization: apiKey } })
  lastPexelsCall = Date.now()
  if (!response.ok) {
    throw new Error(`Pexels API error: ${response.status}`)
  }
  return response.json()
}

function mapPhoto(photo: PexelsPhoto): ProviderItem {
  const item: ProviderItem = {
    provider: "pexels",
    source_id: String(photo.id),
    media_type: "image",
    title: photo.alt,
    description: photo.alt,
    source_url: photo.url,
    download_url: photo.src.original ?? "",
    creator: { name: photo.photographer, profile_url: photo.photographer_url },
    license: LICENSE,
    license_url: LICENSE_URL,
    api_tags: [],
    raw: photo,
    width: photo.width,
    height: photo.height,
  }
  if (photo.src.medium) {
    item.thumbnail_url = photo.src.medium
  }
  return item
}

function pickVideoFile(files: PexelsVideoFile[]): PexelsVideoFile | undefined {
  const hd = files.filter((f) => f.quality === "hd")
  const pool = hd.length > 0 ? hd : files
  let best: PexelsVideoFile | undefined
  for (const file of pool) {
    if (!best || file.width > best.width) {
      best = file
    }
  }
  return best
}

function mapVideo(video: PexelsVideo): ProviderItem {
  const file = pickVideoFile(video.video_files)
  const item: ProviderItem = {
    provider: "pexels",
    source_id: String(video.id),
    media_type: "video",
    title: "",
    description: "",
    source_url: video.url,
    download_url: file?.link ?? "",
    creator: { name: video.user.name, profile_url: video.user.url },
    license: LICENSE,
    license_url: LICENSE_URL,
    api_tags: [],
    raw: video,
    width: video.width,
    height: video.height,
    duration_seconds: video.duration,
  }
  if (video.image) {
    item.thumbnail_url = video.image
  }
  return item
}

async function searchPhotos(q: string, limit: number, apiKey: string): Promise<ProviderItem[]> {
  const url = `${PEXELS_PHOTO_URL}?query=${encodeURIComponent(q)}&per_page=${limit}`
  const data = (await pexelsFetch(url, apiKey)) as PexelsPhotoResponse
  return (data.photos ?? []).map(mapPhoto)
}

async function searchVideos(q: string, limit: number, apiKey: string): Promise<ProviderItem[]> {
  const url = `${PEXELS_VIDEO_URL}?query=${encodeURIComponent(q)}&per_page=${limit}`
  const data = (await pexelsFetch(url, apiKey)) as PexelsVideoResponse
  return (data.videos ?? []).map(mapVideo)
}

export const pexelsProvider: Provider = {
  id: "pexels",
  supported: ["image", "video"],
  async search(q: string, type: MediaTypeFilter, limit: number): Promise<ProviderItem[]> {
    const apiKey = requireApiKey()
    switch (type) {
      case "image":
        return searchPhotos(q, limit, apiKey)
      case "video":
        return searchVideos(q, limit, apiKey)
      case "audio":
        return []
      case "all": {
        const photos = await searchPhotos(q, limit, apiKey)
        const videos = await searchVideos(q, limit, apiKey)
        return [...photos, ...videos]
      }
    }
  },
}
