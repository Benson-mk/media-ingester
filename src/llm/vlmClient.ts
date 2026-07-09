import { z } from "zod"

import { logger } from "../common/logger"

export class ApiClientError extends Error {
  readonly name = "ApiClientError"

  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export type ApiClientConfig = {
  readonly api?: boolean
  readonly base_url: string
  readonly model: string
  readonly api_key?: string
}

export type ImageInput =
  | { readonly kind: "data_url"; readonly data_url: string }
  | { readonly kind: "url"; readonly url: string }

export type ImageAnalysisOptions<T> = ApiClientConfig & {
  readonly image: ImageInput
  readonly prompt: string
  readonly schema: z.ZodType<T>
}

type TextPart = {
  readonly type: "text"
  readonly text: string
}

type ImagePart = {
  readonly type: "image_url"
  readonly image_url: {
    readonly url: string
  }
}

export type ChatContentPart = TextPart | ImagePart | AudioPart

export type AudioPart = {
  readonly type: "input_audio"
  readonly input_audio: {
    readonly data_url: string
  }
}

type ChatRequest = {
  readonly model: string
  readonly response_format: {
    readonly type: "json_object"
  }
  readonly messages: readonly [
    {
      readonly role: "user"
      readonly content: readonly ChatContentPart[]
    },
  ]
}

const ChatChoiceSchema = z.object({
  message: z.object({
    content: z.string(),
  }),
})

const ChatCompletionSchema = z.object({
  choices: z.tuple([ChatChoiceSchema]).rest(ChatChoiceSchema),
})

export async function analyzeImage<T>(options: ImageAnalysisOptions<T>): Promise<T | null> {
  const imageUrl = options.image.kind === "data_url" ? options.image.data_url : options.image.url
  return await requestStructuredChatCompletion(options, [
    { type: "text", text: options.prompt },
    { type: "image_url", image_url: { url: imageUrl } },
  ])
}

export async function requestStructuredChatCompletion<T>(
  config: ApiClientConfig & { readonly schema: z.ZodType<T> },
  content: readonly ChatContentPart[],
): Promise<T | null> {
  if (config.api !== true) {
    logger.info("API tagging disabled")
    return null
  }

  const { MEDIA_INGEST_API_KEY } = process.env
  const apiKey = config.api_key ?? MEDIA_INGEST_API_KEY
  if (apiKey === undefined || apiKey.length === 0) {
    throw new ApiClientError(401, "API key missing")
  }

  const response = await fetch(chatCompletionsUrl(config.base_url), {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(chatRequest(config.model, content)),
  })

  if (!response.ok) {
    throw new ApiClientError(response.status, `API request failed with status ${response.status}`)
  }

  const responsePayload: unknown = await response.json()
  const completion = ChatCompletionSchema.parse(responsePayload)
  const rawContent = completion.choices[0].message.content
  const parsedContent = parseAssistantContent(rawContent)
  return config.schema.parse(parsedContent)
}

function chatRequest(model: string, content: readonly ChatContentPart[]): ChatRequest {
  return {
    model,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content }],
  }
}

function chatCompletionsUrl(baseUrl: string): string {
  return new URL("chat/completions", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).href
}

function parseAssistantContent(content: string): unknown {
  try {
    const parsed: unknown = JSON.parse(stripJsonFence(content))
    return parsed
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ApiClientError(502, "API response content was not valid JSON")
    }
    throw error
  }
}

function stripJsonFence(content: string): string {
  const trimmed = content.trim()
  if (!trimmed.startsWith("```")) {
    return content
  }

  return trimmed.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")
}
