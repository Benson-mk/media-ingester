import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import { resolveProviders } from "../commands/resolveProviders"
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
let savedPixabayKey: string | undefined
let savedUnsplashKey: string | undefined

beforeEach(() => {
  savedPexelsKey = process.env["PEXELS_API_KEY"]
  savedPixabayKey = process.env["PIXABAY_API_KEY"]
  savedUnsplashKey = process.env["UNSPLASH_ACCESS_KEY"]
  delete process.env["PIXABAY_API_KEY"]
  process.exitCode = 0
})

afterEach(() => {
  if (savedPexelsKey === undefined) {
    delete process.env["PEXELS_API_KEY"]
  } else {
    process.env["PEXELS_API_KEY"] = savedPexelsKey
  }
  if (savedPixabayKey === undefined) {
    delete process.env["PIXABAY_API_KEY"]
  } else {
    process.env["PIXABAY_API_KEY"] = savedPixabayKey
  }
  if (savedUnsplashKey === undefined) {
    delete process.env["UNSPLASH_ACCESS_KEY"]
  } else {
    process.env["UNSPLASH_ACCESS_KEY"] = savedUnsplashKey
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

  test("pexels with a blank key errors and exits 1", async () => {
    process.env["PEXELS_API_KEY"] = "   "
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

  test("unsplash with a blank key errors and exits 1", async () => {
    process.env["UNSPLASH_ACCESS_KEY"] = "   "
    const errors: string[] = []
    const errSpy = mock((...args: unknown[]) => {
      errors.push(args.map(String).join(" "))
    })
    const original = console.error
    console.error = errSpy as unknown as typeof console.error

    try {
      await runSearchCommand("test", { provider: "unsplash" })
    } finally {
      console.error = original
    }

    expect(process.exitCode).toBe(1)
    expect(errors.join("\n")).toContain("UNSPLASH_ACCESS_KEY required")
  })

  test("pixabay with a blank key errors and exits 1", async () => {
    process.env["PIXABAY_API_KEY"] = "   "
    const errors: string[] = []
    const errSpy = mock((...args: unknown[]) => {
      errors.push(args.map(String).join(" "))
    })
    const original = console.error
    console.error = errSpy as unknown as typeof console.error

    try {
      await runSearchCommand("test", { provider: "pixabay" })
    } finally {
      console.error = original
    }

    expect(process.exitCode).toBe(1)
    expect(errors.join("\n")).toContain("PIXABAY_API_KEY required")
  })

  test("unknown provider errors instead of resolving all providers", async () => {
    const errors: string[] = []
    const errSpy = mock((...args: unknown[]) => {
      errors.push(args.map(String).join(" "))
    })
    const original = console.error
    console.error = errSpy as unknown as typeof console.error

    try {
      await runSearchCommand("test", { provider: "typo" })
    } finally {
      console.error = original
    }

    expect(process.exitCode).toBe(1)
    expect(errors.join("\n")).toContain("Unknown provider: typo")
  })

  test("all registers keyed providers in deterministic priority order", () => {
    process.env["PEXELS_API_KEY"] = "test-pexels-key"
    process.env["PIXABAY_API_KEY"] = "test-pixabay-key"
    process.env["UNSPLASH_ACCESS_KEY"] = "test-unsplash-key"

    const resolved = resolveProviders("all")

    expect(resolved.ok).toBe(true)
    if (!resolved.ok) throw new Error("expected providers to resolve")
    expect(resolved.providers.map(({ id }) => id)).toEqual([
      "pexels",
      "pixabay",
      "unsplash",
      "wikimedia",
    ])
  })

  test("all independently warns and skips each provider with a missing key", () => {
    const warnings: string[] = []
    const warnSpy = mock((...args: unknown[]) => {
      warnings.push(args.map(String).join(" "))
    })
    const original = console.warn
    console.warn = warnSpy as unknown as typeof console.warn

    try {
      process.env["PEXELS_API_KEY"] = "test-pexels-key"
      process.env["PIXABAY_API_KEY"] = ""
      process.env["UNSPLASH_ACCESS_KEY"] = ""
      const withoutPixabayOrUnsplash = resolveProviders("all")
      expect(withoutPixabayOrUnsplash.ok).toBe(true)
      if (!withoutPixabayOrUnsplash.ok) throw new Error("expected providers to resolve")
      expect(withoutPixabayOrUnsplash.providers.map(({ id }) => id)).toEqual([
        "pexels",
        "wikimedia",
      ])

      process.env["PEXELS_API_KEY"] = "\t"
      process.env["PIXABAY_API_KEY"] = "test-pixabay-key"
      process.env["UNSPLASH_ACCESS_KEY"] = "test-unsplash-key"
      const withoutPexels = resolveProviders("all")
      expect(withoutPexels.ok).toBe(true)
      if (!withoutPexels.ok) throw new Error("expected providers to resolve")
      expect(withoutPexels.providers.map(({ id }) => id)).toEqual([
        "pixabay",
        "unsplash",
        "wikimedia",
      ])
    } finally {
      console.warn = original
    }

    expect(warnings).toContain("UNSPLASH_ACCESS_KEY not set, skipping Unsplash")
    expect(warnings).toContain("PIXABAY_API_KEY not set, skipping Pixabay")
    expect(warnings).toContain("PEXELS_API_KEY not set, skipping Pexels")
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
