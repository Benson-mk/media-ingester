import { expect, test } from "bun:test"
import { z } from "zod"

import { ApiClientError, analyzeImage } from "./vlmClient"

const ResultSchema = z.object({
  title: z.string(),
  score: z.number(),
})

type RecordedRequest = {
  readonly authorization: string | null
  readonly body: unknown
}

function serveJsonResponse(
  status: number,
  payload: unknown,
): { readonly url: string; close(): void } {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return Response.json(payload, { status })
    },
  })

  return { url: server.url.href, close: () => server.stop(true) }
}

function serveRecordedJsonResponse(payload: unknown): {
  readonly url: string
  readonly records: readonly RecordedRequest[]
  close(): void
} {
  const records: RecordedRequest[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      records.push({
        authorization: request.headers.get("authorization"),
        body: await request.json(),
      })
      return Response.json(payload)
    },
  })

  return { url: server.url.href, records, close: () => server.stop(true) }
}

test("analyzeImage returns parsed structured object when API responds with JSON content", async () => {
  // Given: local OpenAI-compatible mock server
  const server = serveRecordedJsonResponse({
    choices: [{ message: { content: JSON.stringify({ title: "Golden hour", score: 0.9 }) } }],
  })

  try {
    // When: image analysis runs with explicit API key
    const result = await analyzeImage({
      api: true,
      base_url: server.url,
      model: "vlm-test",
      api_key: "test-key",
      image: { kind: "data_url", data_url: "data:image/png;base64,AAAA" },
      prompt: "describe image",
      schema: ResultSchema,
    })

    // Then: caller schema parsed result and request stayed JSON-structured
    expect(result).toEqual({ title: "Golden hour", score: 0.9 })
    expect(server.records).toHaveLength(1)
    expect(server.records[0]?.authorization).toBe("Bearer test-key")
    expect(server.records[0]?.body).toEqual({
      model: "vlm-test",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "describe image" },
            { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
          ],
        },
      ],
    })
  } finally {
    server.close()
  }
})

test("analyzeImage returns parsed structured object when API wraps JSON in markdown fence", async () => {
  // Given: local OpenAI-compatible mock server returning fenced JSON
  const server = serveJsonResponse(200, {
    choices: [{ message: { content: '```json\n{"title":"Fenced","score":0.8}\n```' } }],
  })

  try {
    // When: image analysis parses assistant content
    const result = await analyzeImage({
      api: true,
      base_url: server.url,
      model: "vlm-test",
      api_key: "test-key",
      image: { kind: "data_url", data_url: "data:image/png;base64,AAAA" },
      prompt: "describe image",
      schema: ResultSchema,
    })

    // Then: caller schema receives JSON object inside the fence
    expect(result).toEqual({ title: "Fenced", score: 0.8 })
  } finally {
    server.close()
  }
})

test("analyzeImage uses MEDIA_INGEST_API_KEY when explicit key is absent", async () => {
  // Given: API key in environment
  const originalEnv = process.env
  process.env = { ...process.env, MEDIA_INGEST_API_KEY: "env-key" }
  const server = serveRecordedJsonResponse({
    choices: [{ message: { content: JSON.stringify({ title: "From env", score: 1 }) } }],
  })

  try {
    // When: image analysis runs without explicit API key
    await analyzeImage({
      api: true,
      base_url: server.url,
      model: "vlm-test",
      image: { kind: "url", url: "https://example.test/photo.jpg" },
      prompt: "describe image",
      schema: ResultSchema,
    })

    // Then: env key authorizes request
    expect(server.records[0]?.authorization).toBe("Bearer env-key")
  } finally {
    process.env = originalEnv
    server.close()
  }
})

test("analyzeImage returns null and logs disabled message when API flag is absent", async () => {
  // Given: disabled API client and captured logs
  const messages: string[] = []
  const originalError = console.error
  console.error = (...data: unknown[]) => {
    messages.push(data.map(String).join(" "))
  }

  try {
    // When: image analysis is requested without api true
    const result = await analyzeImage({
      base_url: "http://127.0.0.1:9",
      model: "vlm-test",
      api_key: "test-key",
      image: { kind: "url", url: "https://example.test/photo.jpg" },
      prompt: "describe image",
      schema: ResultSchema,
    })

    // Then: request is skipped
    expect(result).toBeNull()
    expect(messages).toEqual(["INFO API tagging disabled"])
  } finally {
    console.error = originalError
  }
})

test("analyzeImage throws typed status error when API rejects key", async () => {
  // Given: local mock server returning unauthorized
  const server = serveJsonResponse(401, { error: { message: "bad key" } })

  try {
    // When: image analysis hits HTTP failure
    const failure = analyzeImage({
      api: true,
      base_url: server.url,
      model: "vlm-test",
      api_key: "bad-key",
      image: { kind: "url", url: "https://example.test/photo.jpg" },
      prompt: "describe image",
      schema: ResultSchema,
    })

    // Then: typed error exposes status code
    await expect(failure).rejects.toThrow(ApiClientError)
    await expect(failure).rejects.toHaveProperty("status", 401)
  } finally {
    server.close()
  }
})

test("analyzeImage throws parse error when API returns malformed content", async () => {
  // Given: local mock server returning non-JSON assistant content
  const server = serveJsonResponse(200, { choices: [{ message: { content: "not json" } }] })

  try {
    // When: image analysis parses assistant content
    const failure = analyzeImage({
      api: true,
      base_url: server.url,
      model: "vlm-test",
      api_key: "test-key",
      image: { kind: "url", url: "https://example.test/photo.jpg" },
      prompt: "describe image",
      schema: ResultSchema,
    })

    // Then: typed parse failure is thrown
    await expect(failure).rejects.toThrow("API response content was not valid JSON")
  } finally {
    server.close()
  }
})
