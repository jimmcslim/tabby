import type { GuardResult } from "./guards"
import type { CaptureResult } from "./types"

/**
 * Browser-side capture used by the Playwright sidecar (sidecar/server.ts).
 * Written against minimal structural interfaces so it is unit-testable with a
 * fake and the app itself needs no Playwright dependency.
 *
 * SSRF: the initial URL is vetted by the drain, but a browser follows
 * redirects and loads subresources on its own, so EVERY request is routed
 * through the shared `checkUrl` guard (guards.ts) and aborted when refused.
 *
 * Lifecycle: one fresh browser per capture; the context and the browser are
 * always closed in `finally`, including on timeout (a leaked Chromium once
 * OOM'd the dev machine).
 */

export interface RouteLike {
  request(): { url(): string }
  continue(): Promise<void>
  abort(): Promise<void>
}
export interface PageLike {
  goto(url: string, opts?: { timeout?: number; waitUntil?: "load" | "domcontentloaded" | "networkidle" }): Promise<{ status(): number } | null>
  screenshot(opts: { type: "jpeg"; quality: number; fullPage: boolean; timeout?: number }): Promise<Uint8Array>
}
export interface ContextLike {
  route(pattern: string, handler: (route: RouteLike) => Promise<void>): Promise<void>
  newPage(): Promise<PageLike>
  close(): Promise<void>
}
export interface BrowserLike {
  newContext(opts: {
    viewport: { width: number; height: number }
    serviceWorkers: "block"
    acceptDownloads: false
  }): Promise<ContextLike>
  close(): Promise<void>
}

export const VIEWPORT = { width: 1280, height: 800 }
const NAV_TIMEOUT_MS = 30_000
const DEFAULT_DEADLINE_MS = 45_000
const SETTLE_MS = 1_000

export async function captureWithBrowser(args: {
  launch: () => Promise<BrowserLike>
  url: string
  checkUrl: (url: string) => Promise<GuardResult>
  /** Hard cap for the whole capture, launch to close. */
  deadlineMs?: number
}): Promise<CaptureResult> {
  const { launch, url, checkUrl } = args
  const deadlineMs = args.deadlineMs ?? DEFAULT_DEADLINE_MS

  let browser: BrowserLike | null = null
  let context: ContextLike | null = null
  let blockedReason: string | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  const work = async (): Promise<CaptureResult> => {
    try {
      browser = await launch()
    } catch {
      return { ok: false, reason: "browser-launch-failed", retryable: true }
    }
    context = await browser.newContext({ viewport: VIEWPORT, serviceWorkers: "block", acceptDownloads: false })
    await context.route("**/*", async (route) => {
      const guard = await checkUrl(route.request().url()).catch(() => ({ ok: false as const, reason: "guard-error" }))
      if (guard.ok) return route.continue()
      blockedReason ??= guard.reason
      return route.abort()
    })
    const page = await context.newPage()

    let response: { status(): number } | null
    try {
      response = await page.goto(url, { timeout: NAV_TIMEOUT_MS, waitUntil: "load" })
    } catch {
      // A refused hop surfaces as a navigation error; that is permanent, not transient.
      if (blockedReason) return { ok: false, reason: blockedReason, retryable: false }
      return { ok: false, reason: "navigation-failed", retryable: true }
    }
    const status = response?.status()
    if (typeof status === "number" && status >= 400) {
      return { ok: false, reason: `http-${status}`, httpStatus: status, retryable: false }
    }
    await new Promise((r) => setTimeout(r, SETTLE_MS)) // let late paints land
    try {
      const jpeg = await page.screenshot({ type: "jpeg", quality: 70, fullPage: false, timeout: 15_000 })
      return { ok: true, jpeg: new Uint8Array(jpeg) }
    } catch {
      return { ok: false, reason: "screenshot-failed", retryable: true }
    }
  }

  try {
    return await Promise.race<CaptureResult>([
      work(),
      new Promise<CaptureResult>((resolve) => {
        timer = setTimeout(() => resolve({ ok: false, reason: "timeout", retryable: true }), deadlineMs)
      }),
    ])
  } catch {
    return { ok: false, reason: "capture-error", retryable: true }
  } finally {
    clearTimeout(timer)
    const ctx = context as ContextLike | null
    const br = browser as BrowserLike | null
    await ctx?.close().catch(() => {})
    await br?.close().catch(() => {})
  }
}
