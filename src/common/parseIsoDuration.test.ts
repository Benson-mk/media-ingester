import { expect, test } from "bun:test"

import { parseIsoDuration } from "./parseIsoDuration"

test("parseIsoDuration parses full duration to seconds", () => {
  expect(parseIsoDuration("P0Y0M0DT0H0M5S")).toBe(5)
})

test("parseIsoDuration parses hours and minutes", () => {
  expect(parseIsoDuration("PT1H30M0S")).toBe(5400)
})

test("parseIsoDuration parses fractional seconds", () => {
  expect(parseIsoDuration("PT2.5S")).toBe(2.5)
})

test("parseIsoDuration throws on invalid input", () => {
  expect(() => parseIsoDuration("garbage")).toThrow("Invalid ISO duration")
})
