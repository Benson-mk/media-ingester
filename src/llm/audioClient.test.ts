import { afterEach, beforeEach, expect, test } from "bun:test"
import { z } from "zod"

import { analyzeAudio } from "./audioClient"

const ResultSchema = z.object({
  title: z.string(),
})

const originalEnv = process.env

beforeEach(() => {
  process.env = { ...originalEnv }
})

afterEach(() => {
  process.env = originalEnv
})

test("analyzeAudio sends input_audio chat request using options.model", async () => {
  const requests: Array<{ readonly path: string; readonly body: unknown }> = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      requests.push({ path: new URL(request.url).pathname, body: await request.json() })
      return Response.json({
        choices: [{ message: { content: '```json\n{"title":"heard"}\n```' } }],
      })
    },
  })

  try {
    const result = await analyzeAudio({
      api: true,
      base_url: server.url.href,
      model: "gemini/gemini-3-flash-preview",
      api_key: "test-key",
      audio: { kind: "data_url", data_url: "data:audio/mpeg;base64,QUJD" },
      prompt: "tag audio",
      schema: ResultSchema,
    })

    expect(result).toEqual({ title: "heard" })
    expect(requests).toEqual([
      {
        path: "/chat/completions",
        body: {
          model: "gemini/gemini-3-flash-preview",
          stream: false,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "tag audio" },
                { type: "input_audio", input_audio: { data: "QUJD", format: "mp3" } },
              ],
            },
          ],
        },
      },
    ])
  } finally {
    server.stop(true)
  }
})

test("analyzeAudio sends request to options.base_url", async () => {
  const paths: string[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      await request.json()
      paths.push(new URL(request.url).pathname)
      return Response.json({ choices: [{ message: { content: '{"title":"routed"}' } }] })
    },
  })

  try {
    const result = await analyzeAudio({
      api: true,
      base_url: `${server.url.href}audio-gateway/v1`,
      model: "gemini/gemini-3-flash-preview",
      api_key: "test-key",
      audio: { kind: "data_url", data_url: "data:audio/mpeg;base64,QUJD" },
      prompt: "tag audio",
      schema: ResultSchema,
    })

    expect(result).toEqual({ title: "routed" })
    expect(paths).toEqual(["/audio-gateway/v1/chat/completions"])
  } finally {
    server.stop(true)
  }
})

test("analyzeAudio uses options.api_key", async () => {
  const authorizations: Array<string | null> = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      await request.json()
      authorizations.push(request.headers.get("authorization"))
      return Response.json({ choices: [{ message: { content: '{"title":"keyed"}' } }] })
    },
  })

  try {
    const result = await analyzeAudio({
      api: true,
      base_url: server.url.href,
      model: "gemini/gemini-3-flash-preview",
      api_key: "audio-key",
      audio: { kind: "data_url", data_url: "data:audio/mpeg;base64,QUJD" },
      prompt: "tag audio",
      schema: ResultSchema,
    })

    expect(result).toEqual({ title: "keyed" })
    expect(authorizations).toEqual(["Bearer audio-key"])
  } finally {
    server.stop(true)
  }
})

test("analyzeAudio falls back to MEDIA_INGEST_API_KEY when options.api_key is undefined", async () => {
  process.env = { ...originalEnv, MEDIA_INGEST_API_KEY: "env-fallback-key" }
  const authorizations: Array<string | null> = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      await request.json()
      authorizations.push(request.headers.get("authorization"))
      return Response.json({ choices: [{ message: { content: '{"title":"fallback"}' } }] })
    },
  })

  try {
    const result = await analyzeAudio({
      api: true,
      base_url: server.url.href,
      model: "gemini/gemini-3-flash-preview",
      audio: { kind: "data_url", data_url: "data:audio/mpeg;base64,QUJD" },
      prompt: "tag audio",
      schema: ResultSchema,
    })

    expect(result).toEqual({ title: "fallback" })
    expect(authorizations).toEqual(["Bearer env-fallback-key"])
  } finally {
    server.stop(true)
  }
})
