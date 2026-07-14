// Ported from media-tagger src/bgm/analyzeAudioBasic.ts — keep behavior identical.
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import { logger } from "../common/logger"
import type { AudioInput } from "../llm/audioClient"

export type ClipExtractionResult = AudioInput

export async function extractFirstAudioClip(
  mediaPath: string,
  ffmpegCommand = "ffmpeg",
): Promise<ClipExtractionResult | null> {
  const tempDir = await mkdtemp(join(tmpdir(), "media-ingester-bgm-clip-"))
  const clipPath = join(tempDir, `${basename(mediaPath)}-${crypto.randomUUID()}.mp3`)

  try {
    const proc = Bun.spawn(
      [ffmpegCommand, "-y", "-i", mediaPath, "-t", "30", "-vn", "-acodec", "libmp3lame", clipPath],
      { stdout: "ignore", stderr: "pipe", env: process.env },
    )
    const exitCode = await Promise.race([proc.exited, Bun.sleep(10_000).then(() => "timeout")])
    if (exitCode === "timeout") {
      proc.kill()
      await proc.exited
      logger.warn("ffmpeg clip extraction unavailable", { path: mediaPath, error: "timed out" })
      return null
    }

    const stderr = await new Response(proc.stderr).text()
    if (exitCode !== 0) {
      logger.warn("ffmpeg clip extraction unavailable", {
        path: mediaPath,
        error: stderr.trim() || `exit code ${exitCode}`,
      })
      return null
    }

    const bytes = await Bun.file(clipPath).bytes()
    return {
      kind: "data_url",
      data_url: `data:audio/mpeg;base64,${Buffer.from(bytes).toString("base64")}`,
    }
  } catch (error) {
    if (error instanceof Error) {
      logger.warn("ffmpeg clip extraction unavailable", { path: mediaPath, error: error.message })
      return null
    }
    throw error
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}
