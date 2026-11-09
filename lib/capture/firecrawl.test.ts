import { describe, expect, it } from "bun:test"
import { SdkError } from "@mendable/firecrawl-js"
import { createFirecrawlBackend } from "./firecrawl"

const IMG = new Uint8Array([1, 2, 3, 4])
const SHOT_URL = "https://storage.example/shot.png"

type ScrapeDoc = { screenshot?: string; metadata?: { statusCode?: number } }
function setup(
  scrape: (url: string, options: Record<string, unknown>) => Promise<ScrapeDoc>,
  download?: (url: string) => Response,
) {
  const scrapeCalls: { url: string; options: Record<string, unknown> }[] = []
  const downloads: string[] = []
  const client = {
    scrape: async (url: string, options: Record<string, unknown>) => {
      scrapeCalls.push({ url, options })
      return scrape(url, options)
    },
  }
  const fetchFn = (async (url: string | URL | Request) => {
    downloads.push(String(url))
    return download ? download(String(url)) : new Response(IMG)
  }) as typeof fetch
  return { backend: createFirecrawlBackend({ apiKey: "fc-test", client, fetch: fetchFn }), scrapeCalls, downloads }
}
const doc = (statusCode = 200, screenshot: string | null = SHOT_URL): ScrapeDoc => ({
  screenshot: screenshot ?? undefined,
  metadata: { statusCode },
})

describe("createFirecrawlBackend", () => {
  it("scrapes with a 1280x800 q70 screenshot format and downloads the returned image immediately", async () => {
    const { backend, scrapeCalls, downloads } = setup(async () => doc())
    const r = await backend.captureScreenshot("https://example.com/p")
    expect(r).toEqual({ ok: true, jpeg: IMG })

    expect(scrapeCalls).toHaveLength(1)
    expect(scrapeCalls[0].url).toBe("https://example.com/p")
    expect(scrapeCalls[0].options).toEqual({
      formats: [{ type: "screenshot", fullPage: false, quality: 70, viewport: { width: 1280, height: 800 } }],
      autoResume: false,
    })
    expect(downloads).toEqual([SHOT_URL])
  })

  it("reports the target page's 4xx status as a permanent failure carrying httpStatus", async () => {
    const { backend, downloads } = setup(async () => doc(404))
    expect(await backend.captureScreenshot("https://example.com/x")).toEqual({
      ok: false,
      reason: "http-404",
      httpStatus: 404,
      retryable: false,
    })
    expect(downloads).toEqual([])
  })

  it("reports a missing screenshot as a permanent failure", async () => {
    const { backend } = setup(async () => doc(200, null))
    const r = await backend.captureScreenshot("https://example.com/x")
    expect(r).toMatchObject({ ok: false, reason: "no-screenshot", retryable: false })
  })

  it("treats credit exhaustion, rate limits, auth, 5xx and network errors as retryable, scraping once", async () => {
    for (const [status, reason] of [
      [402, "out-of-credits"],
      [429, "rate-limited"],
      [401, "unauthorized"],
      [503, "backend-error"],
    ] as const) {
      const { backend, scrapeCalls } = setup(async () => {
        throw new SdkError("nope", status)
      })
      expect(await backend.captureScreenshot("https://example.com/")).toEqual({
        ok: false,
        reason,
        retryable: true,
      })
      expect(scrapeCalls).toHaveLength(1)
    }
    // SDK-normalised transport failure (axios timeout / reset): SdkError without a status.
    for (const err of [new SdkError("timeout of 60000ms exceeded", undefined, "ECONNABORTED"), new Error("ECONNRESET")]) {
      const { backend } = setup(async () => {
        throw err
      })
      expect(await backend.captureScreenshot("https://example.com/")).toMatchObject({
        ok: false,
        reason: "network",
        retryable: true,
      })
    }
  })

  it("treats a failed image download as retryable", async () => {
    const { backend } = setup(
      async () => doc(),
      () => new Response("gone", { status: 410 }),
    )
    expect(await backend.captureScreenshot("https://example.com/")).toMatchObject({
      ok: false,
      reason: "download-failed",
      retryable: true,
    })
  })
})
