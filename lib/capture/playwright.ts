import type { CaptureBackend, CaptureFailure, CaptureResult } from "./types"

/**
 * Client for the self-hosted Playwright sidecar (sidecar/server.ts). The
 * sidecar drives Chromium; this side only speaks HTTP. Guards, cap and failure
 * memo stay in drain.ts — the sidecar additionally re-validates every browser
 * request (redirects, subresources) with the same guards.
 *
 * Wire protocol: POST {baseUrl}/screenshot {url} -> 200 image/jpeg, or
 * 422 JSON {ok:false, reason, httpStatus?, retryable} for a capture failure.
 */
const TIMEOUT_MS = 70_000 // above the sidecar's own 45s hard deadline

export function createSidecarBackend(opts: { baseUrl: string; fetch?: typeof fetch }): CaptureBackend {
  const doFetch = opts.fetch ?? fetch
  const endpoint = `${opts.baseUrl.replace(/\/+$/, "")}/screenshot`

  return {
    name: "playwright-sidecar",
    async captureScreenshot(url: string): Promise<CaptureResult> {
      let res: Response
      try {
        res = await doFetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
      } catch {
        return { ok: false, reason: "sidecar-unreachable", retryable: true }
      }

      if (res.status === 422) {
        try {
          const b = (await res.json()) as Partial<CaptureFailure>
          if (typeof b.reason === "string") {
            return {
              ok: false,
              reason: b.reason,
              ...(typeof b.httpStatus === "number" ? { httpStatus: b.httpStatus } : {}),
              retryable: b.retryable === true,
            }
          }
        } catch {
          // fall through
        }
        return { ok: false, reason: "sidecar-error", retryable: true }
      }
      if (!res.ok) return { ok: false, reason: "sidecar-error", retryable: true }
      try {
        return { ok: true, jpeg: new Uint8Array(await res.arrayBuffer()) }
      } catch {
        return { ok: false, reason: "sidecar-error", retryable: true }
      }
    },
  }
}
