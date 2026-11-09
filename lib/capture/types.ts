/**
 * The capture backend seam. A backend turns a public http(s) URL into a JPEG.
 * Hosted Firecrawl (lib/capture/firecrawl.ts) is the first implementation; the
 * Playwright sidecar and the backfill job reuse this interface unchanged.
 *
 * Backends do NOT apply guards (scheme/SSRF, denylist, cap, failure memo):
 * those live in guards.ts and drain.ts so every backend gets them for free.
 */
export type CaptureFailure = {
  ok: false
  /** Short machine-readable cause, stored as the tab's capture_fail_reason. */
  reason: string
  /** HTTP status the target page returned, when known. 4xx triggers the domain-root retry. */
  httpStatus?: number
  /** True for transient/backend problems (rate limit, out of credits, network):
   *  the failure is not memoised and the tab may be tried again. */
  retryable: boolean
}

export type CaptureResult = { ok: true; jpeg: Uint8Array } | CaptureFailure

export interface CaptureBackend {
  readonly name: string
  captureScreenshot(url: string): Promise<CaptureResult>
}
