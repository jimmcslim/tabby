import type { CaptureBackend, CaptureResult } from "./types"

/**
 * Hosted Firecrawl capture backend (opt-in via FIRECRAWL_API_KEY).
 * POST /v2/scrape with a screenshot format; the returned URL expires after
 * ~24h, so the image is downloaded straight away. Guards, cap and failure
 * memo are NOT here — see drain.ts. Every call costs credits, including pages
 * that turn out to be 403/404.
 */
const SCRAPE_ENDPOINT = "https://api.firecrawl.dev/v2/scrape"
const TIMEOUT_MS = 60_000

export function createFirecrawlBackend(opts: { apiKey: string; fetch?: typeof fetch }): CaptureBackend {
  const doFetch = opts.fetch ?? fetch

  return {
    name: "firecrawl",
    async captureScreenshot(url: string): Promise<CaptureResult> {
      let res: Response
      try {
        res = await doFetch(SCRAPE_ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            url,
            formats: [{ type: "screenshot", fullPage: false, quality: 70, viewport: { width: 1280, height: 800 } }],
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
      } catch {
        return { ok: false, reason: "network", retryable: true }
      }

      if (!res.ok) {
        const reason =
          res.status === 402 ? "out-of-credits" : res.status === 429 ? "rate-limited" : res.status === 401 ? "unauthorized" : "backend-error"
        return { ok: false, reason, retryable: true }
      }

      let body: { data?: { screenshot?: string; metadata?: { statusCode?: number } } }
      try {
        body = await res.json()
      } catch {
        return { ok: false, reason: "bad-response", retryable: true }
      }

      const status = body.data?.metadata?.statusCode
      if (typeof status === "number" && status >= 400) {
        return { ok: false, reason: `http-${status}`, httpStatus: status, retryable: false }
      }
      const shotUrl = body.data?.screenshot
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
