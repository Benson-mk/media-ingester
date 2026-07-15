// Ported from media-tagger src/bgm/detectTempoKey.ts — keep behavior identical.
import { logger } from "../common/logger"

export type TempoKeyResult = {
  readonly tempo: { readonly bpm: number; readonly confidence: number }
  readonly key: { readonly value: string; readonly confidence: number }
}

const SAMPLE_RATE = 22_050
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const

// Krumhansl-Kessler key profiles
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

export async function detectTempoKey(
  mediaPath: string,
  ffmpegCommand = "ffmpeg",
): Promise<TempoKeyResult | null> {
  const samples = await decodePcm(mediaPath, ffmpegCommand)
  if (samples === null || samples.length < SAMPLE_RATE) {
    return null
  }

  return {
    tempo: estimateBpm(samples, SAMPLE_RATE) ?? { bpm: 0, confidence: 0 },
    key: estimateKey(samples, SAMPLE_RATE) ?? { value: "unknown", confidence: 0 },
  }
}

async function decodePcm(mediaPath: string, ffmpegCommand: string): Promise<Float32Array | null> {
  try {
    const proc = Bun.spawn(
      // biome-ignore format: ffmpeg args read better on one line each pair
      [ffmpegCommand, "-i", mediaPath, "-t", "30", "-vn", "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "f32le", "-"],
      { stdout: "pipe", stderr: "ignore", env: process.env },
    )
    const stdout = new Response(proc.stdout).arrayBuffer()
    const exitCode = await Promise.race([
      proc.exited,
      Bun.sleep(15_000).then(() => "timeout" as const),
    ])
    if (exitCode === "timeout") {
      proc.kill()
      await proc.exited
      logger.warn("local tempo/key detection unavailable", {
        path: mediaPath,
        error: "ffmpeg timed out",
      })
      return null
    }

    const bytes = await stdout
    if (exitCode !== 0) {
      logger.warn("local tempo/key detection unavailable", {
        path: mediaPath,
        error: `ffmpeg exit code ${exitCode}`,
      })
      return null
    }
    return new Float32Array(bytes, 0, Math.floor(bytes.byteLength / 4))
  } catch (error) {
    if (error instanceof Error) {
      logger.warn("local tempo/key detection unavailable", {
        path: mediaPath,
        error: error.message,
      })
      return null
    }
    throw error
  }
}

// Onset-energy autocorrelation over the 60-200 BPM range.
// ponytail: no octave-error correction (60 vs 120 BPM ambiguity); add multi-harmonic
// scoring if real-world tracks report halved/doubled tempo.
export function estimateBpm(
  samples: Float32Array,
  sampleRate: number,
): { bpm: number; confidence: number } | null {
  const hop = 512
  const win = 1024
  const frameCount = Math.floor((samples.length - win) / hop) + 1
  if (frameCount < 8) {
    return null
  }

  const onsets = new Float64Array(frameCount)
  let previousEnergy = 0
  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * hop
    let energy = 0
    for (let i = start; i < start + win; i++) {
      const s = samples[i] ?? 0
      energy += s * s
    }
    onsets[frame] = Math.max(0, energy - previousEnergy)
    previousEnergy = energy
  }

  const envelopeRate = sampleRate / hop
  const minLag = Math.max(1, Math.floor((60 / 200) * envelopeRate))
  const maxLag = Math.min(frameCount - 1, Math.ceil((60 / 60) * envelopeRate))
  if (maxLag <= minLag) {
    return null
  }

  let mean = 0
  for (let i = 0; i < frameCount; i++) {
    mean += onsets[i] ?? 0
  }
  mean /= frameCount

  let lagZero = 0
  for (let i = 0; i < frameCount; i++) {
    const v = (onsets[i] ?? 0) - mean
    lagZero += v * v
  }
  if (lagZero === 0) {
    return null
  }

  const correlations = new Float64Array(maxLag + 1)
  let bestLag = 0
  for (let lag = minLag; lag <= maxLag; lag++) {
    let correlation = 0
    for (let i = lag; i < frameCount; i++) {
      correlation += ((onsets[i] ?? 0) - mean) * ((onsets[i - lag] ?? 0) - mean)
    }
    correlations[lag] = correlation
    if (correlation > (correlations[bestLag] ?? 0)) {
      bestLag = lag
    }
  }
  if (bestLag === 0 || (correlations[bestLag] ?? 0) <= 0) {
    return null
  }

  // Multiple-lag error guard: an N-beat lag (N=2,3) can out-correlate the true
  // beat lag when the beat interval is fractional (energy splits across bins),
  // so divide the lag while a strong peak exists near lag/2 or lag/3.
  bestLag = correctLagMultiple(correlations, bestLag, minLag)
  const bestCorrelation = correlations[bestLag] ?? 0

  // Parabolic interpolation around the peak for sub-lag BPM precision.
  const y0 = correlations[bestLag - 1] ?? 0
  const y1 = bestCorrelation
  const y2 = correlations[bestLag + 1] ?? 0
  const denominator = y0 - 2 * y1 + y2
  const delta = denominator === 0 ? 0 : (0.5 * (y0 - y2)) / denominator
  const bpm = Math.round((60 * envelopeRate) / (bestLag + delta))
  const confidence = Math.min(1, Math.max(0, bestCorrelation / lagZero))
  return { bpm, confidence }
}

function correctLagMultiple(correlations: Float64Array, startLag: number, minLag: number): number {
  let bestLag = startLag
  let divided = true
  while (divided) {
    divided = false
    for (const divisor of [2, 3]) {
      const target = bestLag / divisor
      if (target < minLag) {
        continue
      }
      let candidate = 0
      for (
        let lag = Math.max(minLag, Math.floor(target) - 1);
        lag <= Math.ceil(target) + 1;
        lag++
      ) {
        if ((correlations[lag] ?? 0) > (correlations[candidate] ?? 0)) {
          candidate = lag
        }
      }
      if (candidate !== 0 && (correlations[candidate] ?? 0) >= 0.4 * (correlations[bestLag] ?? 0)) {
        bestLag = candidate
        divided = true
        break
      }
    }
  }
  return bestLag
}

// Chromagram via Goertzel over C3..B5, matched to Krumhansl-Kessler profiles.
export function estimateKey(
  samples: Float32Array,
  sampleRate: number,
): { value: string; confidence: number } | null {
  const win = 8192
  const chroma = new Array<number>(12).fill(0)
  let frames = 0
  for (let start = 0; start + win <= samples.length; start += win) {
    for (let midi = 48; midi <= 83; midi++) {
      const freq = 440 * 2 ** ((midi - 69) / 12)
      if (freq >= sampleRate / 2) {
        continue
      }
      const pitchClass = midi % 12
      chroma[pitchClass] =
        (chroma[pitchClass] ?? 0) +
        Math.sqrt(Math.max(0, goertzelPower(samples, start, win, freq, sampleRate)))
    }
    frames++
  }
  if (frames === 0 || chroma.every((value) => value === 0)) {
    return null
  }

  let bestScore = Number.NEGATIVE_INFINITY
  let bestValue = "unknown"
  for (let root = 0; root < 12; root++) {
    const note = NOTE_NAMES[root] ?? "C"
    const major = profileCorrelation(chroma, MAJOR_PROFILE, root)
    if (major > bestScore) {
      bestScore = major
      bestValue = `${note} major`
    }
    const minor = profileCorrelation(chroma, MINOR_PROFILE, root)
    if (minor > bestScore) {
      bestScore = minor
      bestValue = `${note} minor`
    }
  }
  return { value: bestValue, confidence: Math.min(1, Math.max(0, bestScore)) }
}

function goertzelPower(
  samples: Float32Array,
  start: number,
  length: number,
  freq: number,
  sampleRate: number,
): number {
  const coeff = 2 * Math.cos((2 * Math.PI * freq) / sampleRate)
  let s1 = 0
  let s2 = 0
  for (let i = start; i < start + length; i++) {
    const s0 = (samples[i] ?? 0) + coeff * s1 - s2
    s2 = s1
    s1 = s0
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2
}

// Pearson correlation between chroma rotated to `root` and a key profile.
function profileCorrelation(
  chroma: readonly number[],
  profile: readonly number[],
  root: number,
): number {
  let meanChroma = 0
  let meanProfile = 0
  for (let i = 0; i < 12; i++) {
    meanChroma += chroma[i] ?? 0
    meanProfile += profile[i] ?? 0
  }
  meanChroma /= 12
  meanProfile /= 12

  let numerator = 0
  let denomChroma = 0
  let denomProfile = 0
  for (let i = 0; i < 12; i++) {
    const c = (chroma[(root + i) % 12] ?? 0) - meanChroma
    const p = (profile[i] ?? 0) - meanProfile
    numerator += c * p
    denomChroma += c * c
    denomProfile += p * p
  }
  const denominator = Math.sqrt(denomChroma * denomProfile)
  return denominator === 0 ? 0 : numerator / denominator
}
