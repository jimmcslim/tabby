import { domainRoot, type GuardResult } from "./guards"
import type { CaptureBackend, CaptureResult } from "./types"

/**
 * Backend-agnostic capture drain. Given tab ids queued by the screenshot
 * route, it applies the shared rules (eligibility, URL guards, per-drain cap,
 * failure memo, 4xx domain-root fallback) around whichever CaptureBackend is
 * plugged in. The Playwright sidecar and the backfill job reuse it unchanged.
 */

export interface DrainTab {
  id: string
  url: string
  ogImage: string | null
  captureFailedAt: string | null
}

/** Persistence ports, so the drain is testable without a DB or filesystem. */
export interface DrainStore {
  getTab(id: string): Promise<DrainTab | null>
  hasScreenshot(id: string): boolean
  writeScreenshot(id: string, jpeg: Uint8Array): void
  recordFailure(id: string, reason: string): Promise<void>
}

export interface DrainResult {
  captured: number
  failed: number
  /** Retryable failures (not memoised). */
  retryable: number
  /** Ids left unprocessed because the cap was reached. */
  deferred: string[]
}

export async function runDrain(args: {
  backend: CaptureBackend
  store: DrainStore
  ids: string[]
  /** Max backend calls this drain (the root fallback counts as a call). */
  limit: number
  checkUrl: (url: string) => Promise<GuardResult>
}): Promise<DrainResult> {
  const { backend, store, ids, limit, checkUrl } = args
  const result: DrainResult = { captured: 0, failed: 0, retryable: 0, deferred: [] }
  let calls = 0

  for (let i = 0; i < ids.length; i++) {
    if (calls >= limit) {
      result.deferred.push(...ids.slice(i))
      break
    }
    const tab = await store.getTab(ids[i])
    if (!tab || tab.captureFailedAt || store.hasScreenshot(tab.id)) continue
    if (tab.ogImage) continue

    const guard = await checkUrl(tab.url)
    if (!guard.ok) {
      // "unresolvable" may be transient; every other rejection is permanent and free.
      if (guard.reason !== "unresolvable") {
        await store.recordFailure(tab.id, guard.reason)
        result.failed++
      }
      continue
    }

    calls++
    let outcome: CaptureResult = await backend.captureScreenshot(tab.url)

    if (!outcome.ok && outcome.httpStatus && outcome.httpStatus >= 400 && outcome.httpStatus < 500) {
      // One root retry per tab: the page is gone/forbidden, but the site's
      // front page is still a better preview than nothing.
      const root = domainRoot(tab.url)
      if (root && calls < limit && (await checkUrl(root)).ok) {
        calls++
        const rootOutcome = await backend.captureScreenshot(root)
        if (rootOutcome.ok) outcome = rootOutcome
        else if (rootOutcome.retryable) outcome = rootOutcome
      }
    }

    if (outcome.ok) {
      store.writeScreenshot(tab.id, outcome.jpeg)
      result.captured++
    } else if (outcome.retryable) {
      result.retryable++
    } else {
      await store.recordFailure(tab.id, outcome.reason)
      result.failed++
    }
  }
  return result
}
