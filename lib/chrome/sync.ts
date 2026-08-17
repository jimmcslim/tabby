import { getDb } from "@/lib/db"
import { tabs } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { syncAutoSessions } from "@/lib/sessions/auto-save"
import { fetchOgImage, fetchTweetData } from "@/lib/og"
import { getBridge, isExtensionSseConnected, dispatchCommand } from "@/lib/extension/bridge"
import { reconcileTabs } from "@/lib/chrome/reconcile"
import type { ChromeTab, SyncResult } from "@/types"

function isSyncResult(data: unknown): data is SyncResult {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof (data as SyncResult).added === "number" &&
    typeof (data as SyncResult).total === "number"
  )
}

const EMPTY_RESULT: SyncResult = { added: 0, updated: 0, closed: 0, total: 0 }

/**
 * Ask the extension for a fresh snapshot (it pushes to /api/extension/sync,
 * which runs syncTabsFromList). If SSE is down the extension pushes on its
 * own cadence anyway, so the last result is at most one interval stale.
 */
export async function syncTabs(): Promise<SyncResult> {
  if (isExtensionSseConnected()) {
    try {
      const data = await dispatchCommand({ type: "snapshot" }, 5000)
      if (isSyncResult(data)) return data
    } catch {
      // fall through to last known result
    }
  }
  return getBridge().lastSyncResult ?? EMPTY_RESULT
}

export async function syncTabsFromList(
  chromeTabs: ChromeTab[],
  options: { isStartup?: boolean } = {},
): Promise<SyncResult> {
  const now = new Date().toISOString()
  const db = await getDb()

  let ogFetchQueue: { id: string; url: string }[] = []
  let tweetFetchQueue: { id: string; url: string }[] = []
  let added = 0
  let updated = 0
  let closed = 0

  // Tab upserts/closes and the "Latest"/"Previous Session" mirror update all
  // run in one transaction, so a failure partway through can never leave the
  // mirrors out of sync with what `tabs` actually says is open — either the
  // whole sync commits together or none of it does.
  //
  // This callback (and syncAutoSessions, which it calls) must stay
  // synchronous: bun:sqlite's transaction() has signature (tx) => T, and
  // silently discards the returned Promise if the callback is async —
  // COMMIT fires before any awaited work inside actually finishes. Do not
  // "finish the job" by adding await here without first switching drivers.
  db.transaction((tx) => {
    const dbTabs = tx.select().from(tabs).where(eq(tabs.status, "open")).all()

    // What changes is decided by a pure planner (see lib/chrome/reconcile.ts);
    // this block only executes the plan. Keeping the two apart is what makes
    // the rebind/close rules testable without a database.
    const plan = reconcileTabs(dbTabs, chromeTabs, { now })

    for (const values of plan.inserts) {
      tx.insert(tabs).values(values).run()
    }

    for (const { id, values } of plan.updates) {
      tx.update(tabs).set(values).where(eq(tabs.id, id)).run()
    }

    for (const id of plan.closes) {
      tx.update(tabs)
        .set({ status: "closed", closedAt: now, chromeId: null, updatedAt: now })
        .where(eq(tabs.id, id))
        .run()
    }

    ogFetchQueue = plan.ogFetch
    tweetFetchQueue = plan.tweetFetch
    added = plan.inserts.length
    updated = plan.updates.length
    closed = plan.closes.length

    // dbTabs — the open set as it stood before this sync's mutations — is the
    // authoritative "what was open before" source for isStartup's
    // Previous-Session snapshot (see syncAutoSessions).
    syncAutoSessions(tx, !!options.isStartup, dbTabs)
  })

  // Fetch OG images and tweet data in the background (non-blocking).
  // OG fetches are capped per sync so a large backlog (e.g. first sync of
  // hundreds of tabs) drains gradually; unfetched tabs still have ogImage
  // null and re-queue next sync. "" records checked-but-none so sites
  // without OG tags aren't refetched forever.
  const OG_FETCH_LIMIT = 15
  const ogBatch = ogFetchQueue.slice(0, OG_FETCH_LIMIT)
  const enrichPromises: Promise<unknown>[] = []

  if (ogBatch.length > 0) {
    enrichPromises.push(
      Promise.allSettled(
        ogBatch.map(async ({ id, url }) => {
          const ogImage = await fetchOgImage(url)
          await db
            .update(tabs)
            .set({ ogImage: ogImage ?? "", updatedAt: new Date().toISOString() })
            .where(eq(tabs.id, id))
        }),
      ),
    )
  }

  if (tweetFetchQueue.length > 0) {
    enrichPromises.push(
      Promise.allSettled(
        tweetFetchQueue.map(async ({ id, url }) => {
          const tweet = await fetchTweetData(url)
          if (tweet) {
            await db
              .update(tabs)
              .set({
                description: JSON.stringify(tweet),
                ogImage: tweet.imageUrl,
                updatedAt: new Date().toISOString(),
              })
              .where(eq(tabs.id, id))
          }
        }),
      ),
    )
  }

  Promise.all(enrichPromises).catch(() => {})

  return { added, updated, closed, total: chromeTabs.length }
}
