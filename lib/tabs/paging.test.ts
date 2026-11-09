import { describe, expect, it } from "bun:test"
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  parsePageSize,
} from "./paging"

describe("cursor", () => {
  it("round-trips, including awkward characters in the id", () => {
    const cursor = { lastSeenAt: "2026-11-08T12:51:49.857Z", id: "a|b/c+d=é" }
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
  })

  it("is URL-safe", () => {
    expect(encodeCursor({ lastSeenAt: "2026-01-01T00:00:00.000Z", id: "??>>" })).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it("returns null for missing or malformed input", () => {
    expect(decodeCursor(null)).toBeNull()
    expect(decodeCursor("")).toBeNull()
    expect(decodeCursor("not-base64-json!!")).toBeNull()
    expect(decodeCursor(Buffer.from("[1,2]").toString("base64url"))).toBeNull()
    expect(decodeCursor(Buffer.from('["only-one"]').toString("base64url"))).toBeNull()
    expect(decodeCursor(Buffer.from('{"a":1}').toString("base64url"))).toBeNull()
  })
})

describe("parsePageSize", () => {
  it("defaults when absent or invalid", () => {
    expect(parsePageSize(null)).toBe(DEFAULT_PAGE_SIZE)
    expect(parsePageSize("abc")).toBe(DEFAULT_PAGE_SIZE)
    expect(parsePageSize("0")).toBe(DEFAULT_PAGE_SIZE)
    expect(parsePageSize("-5")).toBe(DEFAULT_PAGE_SIZE)
  })

  it("accepts a valid size and clamps to the maximum", () => {
    expect(parsePageSize("25")).toBe(25)
    expect(parsePageSize(String(MAX_PAGE_SIZE + 1))).toBe(MAX_PAGE_SIZE)
  })
})
