// Ported from media-tagger src/video/sampleFrames.ts — keep behavior identical.
import { mkdir, readdir, rm } from "node:fs/promises"
import { join, parse } from "node:path"

import { logger } from "../common/logger"

export type SampledFrame = {
  readonly time: number
  readonly path: string
}

export type FrameCommandResult =
  | { readonly kind: "ok" }
  | { readonly kind: "failed"; readonly exitCode: number }
  | { readonly kind: "missing" }
  | { readonly kind: "timeout" }

export type FrameCommandRunner = (command: readonly string[]) => Promise<FrameCommandResult>

export type SampleFramesOptions = {
  readonly intervalSeconds?: number
  readonly maxFrames?: number
  readonly durationSeconds?: number
  readonly runner?: FrameCommandRunner
}

const DEFAULT_INTERVAL_SECONDS = 3
const DEFAULT_MAX_FRAMES = 20
const FFMPEG_TIMEOUT_MS = 30_000
const TIMESTAMP_LABEL =
  "drawtext=text='%{pts\\:hms}':x=8:y=8:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.5"

export async function sampleFrames(
  inputPath: string,
  options: SampleFramesOptions = {},
): Promise<readonly SampledFrame[]> {
  const maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES
  const intervalSeconds =
    options.intervalSeconds ??
    (options.durationSeconds !== undefined
      ? Math.max(DEFAULT_INTERVAL_SECONDS, Math.ceil(options.durationSeconds / maxFrames))
      : DEFAULT_INTERVAL_SECONDS)
  const runner = options.runner ?? runFfmpeg
  const parsedInput = parse(inputPath)
  const cacheDir = join(parsedInput.dir, ".media_cache", parsedInput.name)
  const outputPattern = join(cacheDir, "frame_%03d.jpg")

  await rm(cacheDir, { recursive: true, force: true })
  await mkdir(cacheDir, { recursive: true })

  const ffmpegCommand = (filter: string): readonly string[] => [
    "ffmpeg",
    "-i",
    inputPath,
    "-vf",
    filter,
    "-q:v",
    "2",
    outputPattern,
  ]

  let result = await runner(ffmpegCommand(`fps=1/${intervalSeconds},${TIMESTAMP_LABEL}`))

  if (result.kind === "failed") {
    logger.warn("ffmpeg timestamp labels unavailable; retrying without labels", {
      path: inputPath,
    })
    result = await runner(ffmpegCommand(`fps=1/${intervalSeconds}`))
  }

  if (result.kind === "missing") {
    logger.warn("ffmpeg unavailable; video frames skipped", { path: inputPath })
    return []
  }

  if (result.kind !== "ok") {
    logger.warn("ffmpeg frame sampling failed", { path: inputPath })
    return []
  }

  const frameNames = (await readdir(cacheDir))
    .filter((entry) => /^frame_\d{3}\.jpg$/.test(entry))
    .sort()
    .slice(0, maxFrames)

  return frameNames.map((frameName, index) => ({
    time: index * intervalSeconds,
    path: join(cacheDir, frameName),
  }))
}

async function runFfmpeg(command: readonly string[]): Promise<FrameCommandResult> {
  try {
    const process = Bun.spawn([...command], { stdout: "pipe", stderr: "pipe" })
    const timeout = setTimeout(() => process.kill(), FFMPEG_TIMEOUT_MS)
    const exitCode = await process.exited
    clearTimeout(timeout)
    await Promise.all([
      new Response(process.stdout).arrayBuffer(),
      new Response(process.stderr).arrayBuffer(),
    ])
    return exitCode === 0 ? { kind: "ok" } : { kind: "failed", exitCode }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { kind: "missing" }
    }
    throw error
  }
}
