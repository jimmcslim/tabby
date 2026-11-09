import { describe, expect, it } from "bun:test"
import { createFirecrawlBackend } from "./firecrawl"

const IMG = new Uint8Array([1, 2, 3, 4])
const SHOT_URL = "https://storage.example/shot.png"

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>
function setup(handler: Handler) {
  const requests: { url: string; init?: RequestInit }[] = []
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init })
    return handler(String(url), init)
  }) as typeof fetch
  return { backend: createFirecrawlBackend({ apiKey: "fc-test", fetch: fetchFn }), requests }
}
const scrapeOk = (statusCode = 200, screenshot: string | null = SHOT_URL) =>
  Response.json({ success: true, data: { screenshot: screenshot ?? undefined, metadata: { statusCode } } })

describe("createFirecrawlBackend", () => {
  it("scrapes with a 1280x800 q70 screenshot format and downloads the returned image immediately", async () => {
    const { backend, requests } = setup((url) => (url === SHOT_URL ? new Response(IMG) : scrapeOk()))
    const r = await backend.captureScreenshot("https://example.com/p")
    expect(r).toEqual({ ok: true, jpeg: IMG })

    const scrape = requests[0]
    expect(scrape.url).toBe("https://api.firecrawl.dev/v2/scrape")
    expect((scrape.init?.headers as Record<string, string>).Authorization).toBe("Bearer fc-test")
    expect(JSON.parse(String(scrape.init?.body))).toEqual({
      url: "https://example.com/p",
      formats: [{ type: "screenshot", fullPage: false, quality: 70, viewport: { width: 1280, height: 800 } }],
    })
    expect(requests[1].url).toBe(SHOT_URL)
  })

  it("reports the target page's 4xx status as a permanent failure carrying httpStatus", async () => {
    const { backend } = setup(() => scrapeOk(404))
    expect(await backend.captureScreenshot("https://example.com/x")).toEqual({
      ok: false,
      reason: "http-404",
      httpStatus: 404,
      retryable: false,
    })
  })

  it("reports a missing screenshot as a permanent failure", async () => {
    const { backend } = setup(() => scrapeOk(200, null))
    const r = await backend.captureScreenshot("https://example.com/x")
    expect(r).toMatchObject({ ok: false, reason: "no-screenshot", retryable: false })
  })

  it("treats credit exhaustion, rate limits, auth, 5xx and network errors as retryable", async () => {
    for (const [status, reason] of [
      [402, "out-of-credits"],
      [429, "rate-limited"],
      [401, "unauthorized"],
      [503, "backend-error"],
    ] as const) {
      const { backend } = setup(() => new Response("nope", { status }))
      expect(await backend.captureScreenshot("https://example.com/")).toEqual({
        ok: false,
        reason,
        retryable: true,
      })
    }
    const { backend } = setup(() => {
      throw new Error("ECONNRESET")
    })
    expect(await backend.captureScreenshot("https://example.com/")).toMatchObject({
      ok: false,
      reason: "network",
      retryable: true,
    })
  })

  it("treats a failed image download as retryable", async () => {
    const { backend } = setup((url) => (url === SHOT_URL ? new Response("gone", { status: 410 }) : scrapeOk()))
    expect(await backend.captureScreenshot("https://example.com/")).toMatchObject({
      ok: false,
      reason: "download-failed",
      retryable: true,
    })
  })
})
