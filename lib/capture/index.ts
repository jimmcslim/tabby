import { getDb } from "@/lib/db"
import { tabs } from "@/lib/db/schema"
import { ensureScreenshotDir, screenshotPath } from "@/lib/screenshots"
import { eq } from "drizzle-orm"
import fs from "node:fs"
import { runDrain, type DrainStore } from "./drain"
import { createFirecrawlBackend } from "./firecrawl"
import { checkCaptureUrl, loadDenylist } from "./guards"
import { createCaptureQueue } from "./queue"
import type { CaptureBackend } from "./types"

/**
 * Entry point for server-side screenshot capture. The screenshot route calls
 * `enqueueCapture(tabId)` on a cache miss; everything else is background.
 * To add a backend (Playwright sidecar, #56), extend resolveCaptureBackend.
 */

const DEFAULT_DRAIN_LIMIT = 15

export function resolveCaptureBackend(env: NodeJS.ProcessEnv = process.env): CaptureBackend | null {
  if (env.TABBY_DISABLE_ENRICHMENT === "1" || env.TABBY_DISABLE_ENRICHMENT === "true") return null
  const apiKey = env.FIRECRAWL_API_KEY?.trim()
  if (apiKey) return createFirecrawlBackend({ apiKey })
  return null
}

/** Max backend calls per drain (CAPTURE_DRAIN_LIMIT, default 15 like OG_FETCH_LIMIT). */
export function resolveDrainLimit(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number.parseInt(env.CAPTURE_DRAIN_LIMIT ?? "", 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DRAIN_LIMIT
}

export const dbStore: DrainStore = {
  async getTab(id) {
    const db = await getDb()
    const [row] = await db
      .select({
        id: tabs.id,
        url: tabs.url,
        ogImage: tabs.ogImage,
        captureFailedAt: tabs.captureFailedAt,
      })
      .from(tabs)
      .where(eq(tabs.id, id))
      .limit(1)
    return row ?? null
  },
  hasScreenshot: (id) => fs.existsSync(screenshotPath(id)),
  writeScreenshot(id, jpeg) {
    ensureScreenshotDir()
    fs.writeFileSync(screenshotPath(id), jpeg)
  },
  async recordFailure(id, reason) {
    const db = await getDb()
    await db
      .update(tabs)
      .set({ captureFailedAt: new Date().toISOString(), captureFailReason: reason })
      .where(eq(tabs.id, id))
  },
}

type CaptureQueue = ReturnType<typeof createCaptureQueue>
const globalForCapture = globalThis as unknown as { __tabbyCaptureQueue?: CaptureQueue | null }

function getQueue(): CaptureQueue | null {
  const backend = resolveCaptureBackend()
  if (!backend) return null
  // One queue per process (survives dev-server module reloads).
  globalForCapture.__tabbyCaptureQueue ??= createCaptureQueue({
    run: (ids) => {
      const denylist = loadDenylist()
      return runDrain({
        backend,
        store: dbStore,
        ids,
        limit: resolveDrainLimit(),
        checkUrl: (url) => checkCaptureUrl(url, { denylist }),
      })
    },
  })
  return globalForCapture.__tabbyCaptureQueue
}

/** Fire-and-forget: queue a tab for background capture. No-op unless a backend is configured. */
export function enqueueCapture(tabId: string): void {
  try {
    getQueue()?.enqueue(tabId)
  } catch {
    // Capture is best-effort; never break the route.
  }
}
