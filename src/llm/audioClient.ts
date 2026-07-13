import { z } from "zod"

import { type ApiClientConfig, ApiClientError } from "./vlmClient"

export type AudioInput =
  | { readonly kind: "data_url"; readonly data_url: string }
  | { readonly kind: "url"; readonly url: string }

export type AudioAnalysisOptions<T> = ApiClientConfig & {
  readonly audio: AudioInput
  readonly prompt: string
  readonly schema: z.ZodType<T>
}

const ChatCompletionSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string(),
      }),
    }),
  ),
})

export async function analyzeAudio<T>(options: AudioAnalysisOptions<T>): Promise<T | null> {
  if (options.api !== true) {
    return null
  }

  const { MEDIA_INGEST_API_KEY } = process.env
  const apiKey = options.api_key ?? MEDIA_INGEST_API_KEY
  if (apiKey === undefined || apiKey.length === 0) {
    throw new ApiClientError(401, "API key missing")
  }

  const model = options.model
  const baseUrl = options.base_url
  const response = await fetch(chatCompletionsUrl(baseUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(chatRequest(model, options.prompt, audioPayload(options.audio))),
  })

  if (!response.ok) {
    throw new ApiClientError(response.status, `API request failed with status ${response.status}`)
  }

  const payload = ChatCompletionSchema.parse(await response.json())
  const content = payload.choices[0]?.message.content
  if (content === undefined) {
    throw new ApiClientError(502, "API response did not include choices")
  }
  return options.schema.parse(JSON.parse(stripJsonFences(content)))
}

function chatRequest(model: string, prompt: string, audio: ReturnType<typeof audioPayload>) {
  return {
    model,
    stream: false,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "input_audio", input_audio: audio },
        ],
      },
    ],
  }
}

function audioPayload(audio: AudioInput): { readonly data: string; readonly format: "mp3" } {
  const dataUrl = audio.kind === "data_url" ? audio.data_url : audio.url
  const match = /^data:audio\/(mpeg|mp3);base64,(.+)$/.exec(dataUrl)
  if (match === null) {
    throw new ApiClientError(400, "audio input must be mp3 data URL")
  }

  return { data: match[2] ?? "", format: "mp3" }
}

function chatCompletionsUrl(baseUrl: string): string {
  return new URL("chat/completions", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).href
}

function stripJsonFences(content: string): string {
  const match = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(content)
  return match?.[1] ?? content
}
