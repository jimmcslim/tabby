/**
 * Backfill previews for open tabs with no capture (#57).
 *   bun run capture:backfill                  dry run: counts only, no credits
 *   bun run capture:backfill --apply          capture up to CAPTURE_DRAIN_LIMIT (15)
 *   bun run capture:backfill --apply --limit 50
 * Re-run to resume: tabs already captured or memoised as failed are skipped.
 * Uses DATABASE_PATH / data/tabby.db like the app; use a scratch DATABASE_PATH to test.
 */
import { dbStore, resolveCaptureBackend } from "@/lib/capture"
import { parseBackfillArgs, runBackfill } from "@/lib/capture/backfill"
import { checkCaptureUrl, loadDenylist } from "@/lib/capture/guards"
import { getDb } from "@/lib/db"
import { tabs } from "@/lib/db/schema"
import { screenshotPath } from "@/lib/screenshots"
import fs from "node:fs"

const { apply, limit } = parseBackfillArgs(process.argv.slice(2), process.env)
const backend = resolveCaptureBackend()
if (apply && !backend) {
  console.error("No capture backend configured: set FIRECRAWL_API_KEY and unset TABBY_DISABLE_ENRICHMENT.")
  process.exit(1)
}

const db = await getDb()
// All rows: closed tabs are not backfilled but their captures cover same-URL open tabs.
const all = await db
  .select({
    id: tabs.id,
    url: tabs.url,
    ogImage: tabs.ogImage,
    captureFailedAt: tabs.captureFailedAt,
    lastAccessedAt: tabs.lastAccessedAt,
    firstSeenAt: tabs.firstSeenAt,
    status: tabs.status,
  })
  .from(tabs)
const hasFile = (id: string) => fs.existsSync(screenshotPath(id))

const { plan, drain } = await runBackfill({
  rows: all,
  hasFile,
  apply,
  limit,
  backend,
  store: dbStore,
  checkUrl: (url) => checkCaptureUrl(url, { denylist: loadDenylist() }),
})

console.log(`Open tabs with no capture or OG image: ${plan.eligible.length}`)
console.log(`Skipped: ${JSON.stringify(plan.skipped)}`)
console.log(`Worst-case backend calls (4xx root retry doubles): ${plan.worstCaseCalls}`)
if (!drain) {
  console.log(`Dry run. Re-run with --apply to capture up to ${limit} calls' worth.`)
} else {
  console.log(`Captured ${drain.captured}, failed ${drain.failed}, retryable ${drain.retryable}, deferred ${drain.deferred.length}`)
}
