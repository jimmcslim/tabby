import { runDrain, type DrainResult, type DrainStore } from "./drain"
import type { GuardResult } from "./guards"
import type { CaptureBackend } from "./types"

/**
 * Backfill planning for open tabs that have no capture and no OG image (#57).
 * Pure: the CLI (scripts/capture-backfill.ts) supplies rows and a file check.
 * The actual capturing is runDrain, so guards, cap, failure memo and the 4xx
 * root fallback are shared with the on-demand queue.
 */

export interface BackfillRow {
  id: string
  url: string
  ogImage: string | null
  captureFailedAt: string | null
  /** Chrome's last-accessed time, the closest thing to "last opened". */
  lastAccessedAt: string | null
  firstSeenAt: string
  /** Only "open" tabs are backfilled; other rows still count as capture sources. */
  status: string
}

export interface BackfillPlan {
  /** Tab ids to capture, most recently accessed first. */
  eligible: string[]
  skipped: { hasCapture: number; hasOgImage: number; previouslyFailed: number; sameUrlCovered: number }
  /** Each eligible tab can cost a second call (the 4xx domain-root retry). */
  worstCaseCalls: number
}

export function planBackfill(rows: BackfillRow[], hasFile: (id: string) => boolean): BackfillPlan {
  const skipped = { hasCapture: 0, hasOgImage: 0, previouslyFailed: 0, sameUrlCovered: 0 }
  // URLs that already have a capture on some tab row; the screenshot route
  // reuses it for same-URL tabs (#54), so those tabs need no backend call.
  const coveredUrls = new Set(rows.filter((r) => hasFile(r.id)).map((r) => r.url))
  const candidates: BackfillRow[] = []
  for (const r of rows) {
    if (r.status !== "open") continue
    if (hasFile(r.id)) skipped.hasCapture++
    else if (r.ogImage) skipped.hasOgImage++
    else if (r.captureFailedAt) skipped.previouslyFailed++
    else if (coveredUrls.has(r.url)) skipped.sameUrlCovered++
    else candidates.push(r)
  }
  candidates.sort((a, b) => {
    if (a.lastAccessedAt && b.lastAccessedAt) {
      if (a.lastAccessedAt !== b.lastAccessedAt) return a.lastAccessedAt < b.lastAccessedAt ? 1 : -1
    } else if (a.lastAccessedAt || b.lastAccessedAt) {
      return a.lastAccessedAt ? -1 : 1
    }
    return a.firstSeenAt < b.firstSeenAt ? 1 : a.firstSeenAt > b.firstSeenAt ? -1 : 0
  })
  return { eligible: candidates.map((c) => c.id), skipped, worstCaseCalls: candidates.length * 2 }
}

export function parseBackfillArgs(argv: string[], env: NodeJS.ProcessEnv): { apply: boolean; limit: number } {
  const envLimit = Number.parseInt(env.CAPTURE_DRAIN_LIMIT ?? "", 10)
  let limit = Number.isFinite(envLimit) && envLimit > 0 ? envLimit : 15
  let apply = false
  const parseLimit = (v: string | undefined) => {
    const n = Number(v)
    if (!v || !Number.isInteger(n) || n < 1) throw new Error(`--limit needs a positive integer, got "${v ?? ""}"`)
    return n
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--apply") apply = true
    else if (a === "--limit") limit = parseLimit(argv[++i])
    else if (a.startsWith("--limit=")) limit = parseLimit(a.slice(8))
    else throw new Error(`Unknown argument: ${a}`)
  }
  return { apply, limit }
}

export async function runBackfill(args: {
  rows: BackfillRow[]
  hasFile: (id: string) => boolean
  apply: boolean
  limit: number
  backend: CaptureBackend | null
  store: DrainStore
  checkUrl: (url: string) => Promise<GuardResult>
}): Promise<{ plan: BackfillPlan; drain: DrainResult | null }> {
  const plan = planBackfill(args.rows, args.hasFile)
  if (!args.apply) return { plan, drain: null }
  if (!args.backend) {
    throw new Error("No capture backend configured (set FIRECRAWL_API_KEY; TABBY_DISABLE_ENRICHMENT must not be set)")
  }
  const drain = await runDrain({
    backend: args.backend,
    store: args.store,
    ids: plan.eligible,
    limit: args.limit,
    checkUrl: args.checkUrl,
  })
  return { plan, drain }
}
