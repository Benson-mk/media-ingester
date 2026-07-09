import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import { runSearchCommand } from "../commands/search"

const WIKI_SEARCH = {
  query: { search: [{ title: "File:Test image.jpg" }] },
}

const WIKI_DETAIL = {
  query: {
    pages: {
      "-1": {
        title: "File:Test image.jpg",
        imageinfo: [
          {
            url: "https://upload.wikimedia.org/test.jpg",
            mime: "image/jpeg",
            width: 800,
            height: 600,
            extmetadata: {
              LicenseShortName: { value: "CC BY-SA 4.0" },
              Artist: { value: "<a>Jane Doe</a>" },
              ImageDescription: { value: "A <b>test</b> image" },
            },
          },
        ],
      },
    },
  },
}

function wikimediaFetch(input: string | URL | Request): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString()
  const body = url.includes("list=search") ? WIKI_SEARCH : WIKI_DETAIL
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}

let savedPexelsKey: string | undefined

beforeEach(() => {
  savedPexelsKey = process.env["PEXELS_API_KEY"]
  process.exitCode = 0
})

afterEach(() => {
  if (savedPexelsKey === undefined) {
    delete process.env["PEXELS_API_KEY"]
  } else {
    process.env["PEXELS_API_KEY"] = savedPexelsKey
  }
  ;(global as { fetch?: unknown }).fetch = undefined
  process.exitCode = 0
})

describe("runSearchCommand", () => {
  test("wikimedia results printed to stdout without raw field", async () => {
    global.fetch = mock(wikimediaFetch) as unknown as typeof fetch
    const logs: string[] = []
    const logSpy = mock((...args: unknown[]) => {
      logs.push(args.map(String).join(" "))
    })
    const original = console.log
    console.log = logSpy as unknown as typeof console.log

    try {
      await runSearchCommand("test", { provider: "wikimedia" })
    } finally {
      console.log = original
    }

    expect(logSpy).toHaveBeenCalledTimes(1)
    const printed = JSON.parse(logs[0] ?? "[]") as Array<Record<string, unknown>>
    expect(printed.length).toBe(1)
    expect(printed[0]?.["provider"]).toBe("wikimedia")
    expect(printed[0]?.["source_id"]).toBe("File:Test image.jpg")
    expect("raw" in (printed[0] ?? {})).toBe(false)
    expect(process.exitCode).toBe(0)
  })

  test("pexels with no key errors and exits 1", async () => {
    delete process.env["PEXELS_API_KEY"]
    const errors: string[] = []
    const errSpy = mock((...args: unknown[]) => {
      errors.push(args.map(String).join(" "))
    })
    const original = console.error
    console.error = errSpy as unknown as typeof console.error

    try {
      await runSearchCommand("test", { provider: "pexels" })
    } finally {
      console.error = original
    }

    expect(process.exitCode).toBe(1)
    expect(errors.join("\n")).toContain("PEXELS_API_KEY required")
  })

  test("provider throwing sets exitCode 1", async () => {
    global.fetch = mock(() =>
      Promise.resolve(new Response("nope", { status: 500 })),
    ) as unknown as typeof fetch
    const errSpy = mock(() => {})
    const original = console.error
    console.error = errSpy as unknown as typeof console.error

    try {
      await runSearchCommand("test", { provider: "wikimedia" })
    } finally {
      console.error = original
    }

    expect(process.exitCode).toBe(1)
  })
})
