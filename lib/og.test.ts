import { describe, expect, it } from "bun:test"
import { extractTweetId, isTweetUrl, parseOgImage, shouldPreferOgImage } from "./og"

describe("shouldPreferOgImage", () => {
  it("prefers the declared artwork on media-heavy domains", () => {
    expect(shouldPreferOgImage("youtube.com")).toBe(true)
    expect(shouldPreferOgImage("www.youtube.com")).toBe(true)
    expect(shouldPreferOgImage("github.com")).toBe(true)
  })

  it("prefers a screenshot everywhere else", () => {
    expect(shouldPreferOgImage("example.com")).toBe(false)
    expect(shouldPreferOgImage(null)).toBe(false)
  })

  it("matches the exact host, not a suffix", () => {
    // Only the listed hosts count — a lookalike domain must not match.
    expect(shouldPreferOgImage("notyoutube.com")).toBe(false)
    expect(shouldPreferOgImage("m.youtube.com")).toBe(false)
  })
})

describe("isTweetUrl", () => {
  it("recognises both twitter.com and x.com, including mobile", () => {
    expect(isTweetUrl("twitter.com")).toBe(true)
    expect(isTweetUrl("x.com")).toBe(true)
    expect(isTweetUrl("mobile.twitter.com")).toBe(true)
    expect(isTweetUrl("mobile.x.com")).toBe(true)
  })

  it("rejects anything else", () => {
    expect(isTweetUrl("example.com")).toBe(false)
    expect(isTweetUrl(null)).toBe(false)
  })
})

describe("extractTweetId", () => {
  it("pulls the status id out of a permalink", () => {
    expect(extractTweetId("https://x.com/someone/status/1234567890")).toBe("1234567890")
    expect(extractTweetId("https://twitter.com/someone/status/42?s=20")).toBe("42")
  })

  it("returns null when there is no status id", () => {
    expect(extractTweetId("https://x.com/someone")).toBeNull()
    expect(extractTweetId("https://example.com/status/abc")).toBeNull()
  })
})

describe("parseOgImage", () => {
  it("reads og:image with content after property", () => {
    const html = `<head><meta property="og:image" content="https://cdn.example.com/a.png"></head>`
    expect(parseOgImage(html)).toBe("https://cdn.example.com/a.png")
  })

  it("reads og:image with the attributes the other way round", () => {
    const html = `<head><meta content="https://cdn.example.com/b.png" property="og:image"/></head>`
    expect(parseOgImage(html)).toBe("https://cdn.example.com/b.png")
  })

  it("accepts single quotes and odd casing", () => {
    const html = `<META PROPERTY='og:image' CONTENT='https://cdn.example.com/c.png'>`
    expect(parseOgImage(html)).toBe("https://cdn.example.com/c.png")
  })

  it("falls back to twitter:image when there is no og:image", () => {
    const html = `<meta name="twitter:image" content="https://cdn.example.com/tw.png">`
    expect(parseOgImage(html)).toBe("https://cdn.example.com/tw.png")
  })

  it("prefers og:image over twitter:image", () => {
    const html = `
      <meta name="twitter:image" content="https://cdn.example.com/tw.png">
      <meta property="og:image" content="https://cdn.example.com/og.png">
    `
    expect(parseOgImage(html)).toBe("https://cdn.example.com/og.png")
  })

  it("takes the first og:image when a page declares several", () => {
    const html = `
      <meta property="og:image" content="https://cdn.example.com/first.png">
      <meta property="og:image" content="https://cdn.example.com/second.png">
    `
    expect(parseOgImage(html)).toBe("https://cdn.example.com/first.png")
  })

  it("returns null for html with no preview image, and for junk", () => {
    expect(parseOgImage(`<html><head><title>No image</title></head></html>`)).toBeNull()
    expect(parseOgImage("")).toBeNull()
    expect(parseOgImage("not html at all")).toBeNull()
  })

  it("ignores an og:image tag with an empty content attribute", () => {
    expect(parseOgImage(`<meta property="og:image" content="">`)).toBeNull()
  })
})
