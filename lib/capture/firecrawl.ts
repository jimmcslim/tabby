import { FirecrawlClient, SdkError } from "@mendable/firecrawl-js"
import type { CaptureBackend, CaptureResult } from "./types"

/**
 * Hosted Firecrawl capture backend (opt-in via FIRECRAWL_API_KEY).
 * Scrapes with a screenshot format via the official SDK; the returned URL
 * expires after ~24h, so the image is downloaded straight away. Guards, cap
 * and failure memo are NOT here — see drain.ts. Every call costs credits,
 * including pages that turn out to be 403/404.
 *
 * BILLING SAFETY: the SDK retries on its own by default, which would spend
 * credits behind drain.ts's back. Verified against @mendable/firecrawl-js
 * 4.52.0 (src/v2/utils/httpClient.ts, src/v2/methods/scrape.ts):
 *  - HttpClient re-sends the request on HTTP 502, up to `maxRetries` (default 3)
 *    attempts total. `maxRetries: 1` means a single attempt (0 would make the
 *    loop never run and throw), so no silent re-send.
 *  - scrape() "auto-resume" re-issues the request after a 408 SCRAPE_TIMEOUT
 *    with `processing_continues`, up to 5 times. `autoResume: false` disables it.
 *  - scrape() does not poll; it is one synchronous POST /v2/scrape.
 * Both knobs are pinned below; failures surface once and drain.ts decides.
 */
const TIMEOUT_MS = 60_000
const API_URL = "https://api.firecrawl.dev"

/** The slice of the SDK client this backend uses; tests inject a fake. */
export interface FirecrawlScrapeClient {
  scrape(
    url: string,
    options: Record<string, unknown>,
  ): Promise<{ screenshot?: string; metadata?: { statusCode?: number } }>
}

export function createFirecrawlBackend(opts: {
  apiKey: string
  client?: FirecrawlScrapeClient
  fetch?: typeof fetch
}): CaptureBackend {
  const doFetch = opts.fetch ?? fetch
  const client: FirecrawlScrapeClient =
    opts.client ??
    new FirecrawlClient({
      apiKey: opts.apiKey,
      apiUrl: API_URL, // explicit: ignore FIRECRAWL_API_URL from the environment
      timeoutMs: TIMEOUT_MS,
      maxRetries: 1, // exactly one attempt: no silent 502 re-send (costs credits)
    })

  return {
    name: "firecrawl",
    async captureScreenshot(url: string): Promise<CaptureResult> {
      let doc: Awaited<ReturnType<FirecrawlScrapeClient["scrape"]>>
      try {
        doc = await client.scrape(url, {
          formats: [{ type: "screenshot", fullPage: false, quality: 70, viewport: { width: 1280, height: 800 } }],
          autoResume: false, // never re-issue a billed request on processing_continues
        })
      } catch (err) {
        const status = err instanceof SdkError ? err.status : undefined
        if (typeof status !== "number") return { ok: false, reason: "network", retryable: true }
        const reason =
          status === 402 ? "out-of-credits" : status === 429 ? "rate-limited" : status === 401 ? "unauthorized" : "backend-error"
        return { ok: false, reason, retryable: true }
      }

      const status = doc.metadata?.statusCode
      if (typeof status === "number" && status >= 400) {
        return { ok: false, reason: `http-${status}`, httpStatus: status, retryable: false }
      }
      const shotUrl = doc.screenshot
      if (!shotUrl) return { ok: false, reason: "no-screenshot", retryable: false }

      try {
        const img = await doFetch(shotUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) })
        if (!img.ok) return { ok: false, reason: "download-failed", retryable: true }
        return { ok: true, jpeg: new Uint8Array(await img.arrayBuffer()) }
      } catch {
        return { ok: false, reason: "download-failed", retryable: true }
      }
    },
  }
}
