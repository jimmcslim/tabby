import { getDb } from "@/lib/db"
import { tabs } from "@/lib/db/schema"
import { listTabs } from "./cdp"
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { updateAutoSession } from "@/lib/sessions/auto-save"
import { shouldPreferOgImage, fetchOgImage, isTweetUrl, fetchTweetData } from "@/lib/og"
import {
  getBridge,
  isExtensionSseConnected,
  isExtensionFresh,
  dispatchCommand,
} from "@/lib/extension/bridge"
import type { ChromeTab, SyncResult } from "@/types"

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

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
 * Sync from whichever source is live: if the extension is connected over SSE,
 * ask it for a fresh snapshot (it pushes to /api/extension/sync, which runs
 * syncTabsFromList); if it reported recently, trust that data; otherwise fall
 * back to pulling via CDP.
 */
export async function syncTabs(): Promise<SyncResult> {
  if (isExtensionSseConnected()) {
    try {
      const data = await dispatchCommand({ type: "snapshot" }, 5000)
      if (isSyncResult(data)) return data
    } catch {
      // fall through to last known result
    }
    return getBridge().lastSyncResult ?? EMPTY_RESULT
  }

  if (await isExtensionFresh()) {
    // Extension is the active source but SSE is momentarily down; its data is
    // at most one debounce interval stale. Don't touch CDP (DevTools banner).
    return getBridge().lastSyncResult ?? EMPTY_RESULT
  }

  return syncTabsFromList(await listTabs())
}

export async function syncTabsFromList(chromeTabs: ChromeTab[]): Promise<SyncResult> {
  const now = new Date().toISOString()
  const db = await getDb()

  const dbTabs = db.select().from(tabs).where(eq(tabs.status, "open")).all()

  const chromeIdSet = new Set(chromeTabs.map((t) => t.id))
  const dbChromeIdMap = new Map(dbTabs.map((t) => [t.chromeId, t]))

  // Rebind pass: when the source switches (CDP targetIds <-> extension ids)
  // or Chrome restarts, every id changes at once. Rebind by exact URL match
  // instead of closing and reinserting all tabs. Open rows with a null
  // chromeId (recovered/anomalous state) are rebind candidates too.
  const missingByUrl = new Map<string, (typeof dbTabs)[number][]>()
  for (const dbTab of dbTabs) {
    if (!dbTab.chromeId || !chromeIdSet.has(dbTab.chromeId)) {
      const list = missingByUrl.get(dbTab.url)
      if (list) list.push(dbTab)
      else missingByUrl.set(dbTab.url, [dbTab])
    }
  }
  const reboundDbIds = new Set<string>()
  for (const chromeTab of chromeTabs) {
    if (dbChromeIdMap.has(chromeTab.id)) continue
    const dbTab = missingByUrl.get(chromeTab.url)?.shift()
    if (dbTab) {
      reboundDbIds.add(dbTab.id)
      dbChromeIdMap.set(chromeTab.id, dbTab)
    }
  }

  let added = 0
  let updated = 0
  let closed = 0
  const ogFetchQueue: { id: string; url: string }[] = []
  const tweetFetchQueue: { id: string; url: string }[] = []

  for (const chromeTab of chromeTabs) {
    const existing = dbChromeIdMap.get(chromeTab.id)
    const domain = extractDomain(chromeTab.url)

    if (existing) {
      db.update(tabs)
        .set({
          chromeId: chromeTab.id,
          url: chromeTab.url,
          title: chromeTab.title,
          domain,
          faviconUrl: chromeTab.faviconUrl || existing.faviconUrl,
          windowId: chromeTab.windowId ?? null,
          tabIndex: chromeTab.tabIndex ?? null,
          // CDP doesn't report focus times — keep the last extension-provided value
          lastAccessedAt: chromeTab.lastAccessedAt ?? existing.lastAccessedAt,
          lastSeenAt: now,
          updatedAt: now,
        })
        .where(eq(tabs.id, existing.id))
        .run()

      // Queue enrichment
      if (isTweetUrl(domain) && !existing.description) {
        tweetFetchQueue.push({ id: existing.id, url: chromeTab.url })
      } else if (
        existing.url !== chromeTab.url &&
        !existing.ogImage &&
        (shouldPreferOgImage(domain) || chromeTab.suspended)
      ) {
        ogFetchQueue.push({ id: existing.id, url: chromeTab.url })
      }
      updated++
    } else {
      const id = nanoid()
      db.insert(tabs)
        .values({
          id,
          chromeId: chromeTab.id,
          url: chromeTab.url,
          title: chromeTab.title,
          domain,
          faviconUrl: chromeTab.faviconUrl || null,
          windowId: chromeTab.windowId ?? null,
          tabIndex: chromeTab.tabIndex ?? null,
          lastAccessedAt: chromeTab.lastAccessedAt ?? null,
          status: "open",
          type: chromeTab.type,
          firstSeenAt: now,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .run()

      if (isTweetUrl(domain)) {
        tweetFetchQueue.push({ id, url: chromeTab.url })
      } else if (shouldPreferOgImage(domain) || chromeTab.suspended) {
        ogFetchQueue.push({ id, url: chromeTab.url })
      }
      added++
    }
  }

  // Close every open row that matched nothing this sync — by chromeId or
  // rebind — so the DB "open" set mirrors Chrome even for null-chromeId rows.
  for (const dbTab of dbTabs) {
    if ((!dbTab.chromeId || !chromeIdSet.has(dbTab.chromeId)) && !reboundDbIds.has(dbTab.id)) {
      db.update(tabs)
        .set({ status: "closed", closedAt: now, chromeId: null, updatedAt: now })
        .where(eq(tabs.id, dbTab.id))
        .run()
      closed++
    }
  }

  await updateAutoSession()

  // Fetch OG images and tweet data in the background (non-blocking)
  const enrichPromises: Promise<unknown>[] = []

  if (ogFetchQueue.length > 0) {
    enrichPromises.push(
      Promise.allSettled(
        ogFetchQueue.map(async ({ id, url }) => {
          const ogImage = await fetchOgImage(url)
          if (ogImage) {
            db.update(tabs)
              .set({ ogImage, updatedAt: new Date().toISOString() })
              .where(eq(tabs.id, id))
              .run()
          }
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
            db.update(tabs)
              .set({
                description: JSON.stringify(tweet),
                ogImage: tweet.imageUrl,
                updatedAt: new Date().toISOString(),
              })
              .where(eq(tabs.id, id))
              .run()
          }
        }),
      ),
    )
  }

  Promise.all(enrichPromises).catch(() => {})

  return { added, updated, closed, total: chromeTabs.length }
}
