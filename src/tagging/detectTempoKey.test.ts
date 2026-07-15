import { expect, test } from "bun:test"

import { estimateBpm, estimateKey } from "./detectTempoKey"

const SAMPLE_RATE = 22_050

function clickTrack(bpm: number, seconds: number): Float32Array {
  const samples = new Float32Array(SAMPLE_RATE * seconds)
  const beatInterval = Math.round((60 / bpm) * SAMPLE_RATE)
  for (let beat = 0; beat * beatInterval < samples.length; beat++) {
    const start = beat * beatInterval
    for (let i = start; i < Math.min(start + 1024, samples.length); i++) {
      samples[i] = Math.sin(2 * Math.PI * 1000 * ((i - start) / SAMPLE_RATE))
    }
  }
  return samples
}

function triad(frequencies: readonly number[], seconds: number): Float32Array {
  const samples = new Float32Array(SAMPLE_RATE * seconds)
  for (let i = 0; i < samples.length; i++) {
    let value = 0
    for (const freq of frequencies) {
      value += Math.sin(2 * Math.PI * freq * (i / SAMPLE_RATE))
    }
    samples[i] = value / frequencies.length
  }
  return samples
}

test("estimateBpm detects 120 BPM click track", () => {
  const result = estimateBpm(clickTrack(120, 20), SAMPLE_RATE)
  expect(result).not.toBeNull()
  expect(Math.abs((result?.bpm ?? 0) - 120)).toBeLessThanOrEqual(2)
  expect(result?.confidence ?? 0).toBeGreaterThan(0)
})

test("estimateKey detects C major triad", () => {
  // C4, E4, G4
  const result = estimateKey(triad([261.63, 329.63, 392.0], 5), SAMPLE_RATE)
  expect(result?.value).toBe("C major")
  expect(result?.confidence ?? 0).toBeGreaterThan(0.5)
})

test("estimateBpm detects 190 BPM click track without picking a beat multiple", () => {
  const result = estimateBpm(clickTrack(190, 20), SAMPLE_RATE)
  expect(result).not.toBeNull()
  expect(Math.abs((result?.bpm ?? 0) - 190)).toBeLessThanOrEqual(3)
})

test("estimateBpm returns null on silence", () => {
  expect(estimateBpm(new Float32Array(SAMPLE_RATE * 5), SAMPLE_RATE)).toBeNull()
})
