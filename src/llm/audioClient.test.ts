import { afterEach, beforeEach, expect, test } from "bun:test"
import { z } from "zod"

import { analyzeAudio } from "./audioClient"

const ResultSchema = z.object({
  title: z.string(),
})

const originalEnv = process.env

beforeEach(() => {
  process.env = { ...originalEnv, MEDIA_INGEST_AUDIO_MODEL: "gemini/gemini-3-flash-preview" }
})

afterEach(() => {
  process.env = originalEnv
})

test("analyzeAudio sends input_audio chat request using MEDIA_INGEST_AUDIO_MODEL", async () => {
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
      model: "cx/gpt-5.5",
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

test("analyzeAudio sends request to MEDIA_INGEST_AUDIO_BASE_URL when set", async () => {
  const paths: string[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      await request.json()
      paths.push(new URL(request.url).pathname)
      return Response.json({ choices: [{ message: { content: '{"title":"routed"}' } }] })
    },
  })
  process.env = {
    ...originalEnv,
    MEDIA_INGEST_AUDIO_MODEL: "gemini/gemini-3-flash-preview",
    MEDIA_INGEST_AUDIO_BASE_URL: `${server.url.href}audio-gateway/v1`,
  }

  try {
    const result = await analyzeAudio({
      api: true,
      base_url: "http://unused.invalid/v1",
      model: "cx/gpt-5.5",
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

test("analyzeAudio uses MEDIA_INGEST_AUDIO_API_KEY when set", async () => {
  const authorizations: Array<string | null> = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      await request.json()
      authorizations.push(request.headers.get("authorization"))
      return Response.json({ choices: [{ message: { content: '{"title":"keyed"}' } }] })
    },
  })
  process.env = {
    ...originalEnv,
    MEDIA_INGEST_AUDIO_MODEL: "gemini/gemini-3-flash-preview",
    MEDIA_INGEST_AUDIO_API_KEY: "audio-key",
  }

  try {
    const result = await analyzeAudio({
      api: true,
      base_url: server.url.href,
      model: "cx/gpt-5.5",
      api_key: "default-key",
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

test("analyzeAudio falls back to config model without MEDIA_INGEST_AUDIO_MODEL", async () => {
  const { MEDIA_INGEST_AUDIO_MODEL: _unused, ...envWithoutAudioModel } = originalEnv
  process.env = { ...envWithoutAudioModel }
  const models: string[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as { model: string }
      models.push(body.model)
      return Response.json({ choices: [{ message: { content: '{"title":"plain"}' } }] })
    },
  })

  try {
    const result = await analyzeAudio({
      api: true,
      base_url: server.url.href,
      model: "cx/gpt-5.5",
      api_key: "test-key",
      audio: { kind: "data_url", data_url: "data:audio/mpeg;base64,QUJD" },
      prompt: "tag audio",
      schema: ResultSchema,
    })

    expect(result).toEqual({ title: "plain" })
    expect(models).toEqual(["cx/gpt-5.5"])
  } finally {
    server.stop(true)
  }
})
