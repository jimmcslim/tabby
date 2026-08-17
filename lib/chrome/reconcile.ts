import { nanoid } from "nanoid"
import { isTweetUrl } from "@/lib/og"
import type { ChromeTab, TabSuspendedState } from "@/types"

/**
 * The subset of an open `tabs` row the reconciler actually reads. Declared
 * structurally (rather than importing drizzle's row type) so this module stays
 * free of any DB dependency and can be tested with plain object literals.
 */
export interface ReconcileTab {
  id: string
  chromeId: string | null
  url: string
  faviconUrl: string | null
  lastAccessedAt: string | null
  ogImage: string | null
  description: string | null
}

export interface TabInsert {
  id: string
  chromeId: string
  url: string
  title: string
  domain: string | null
  faviconUrl: string | null
  windowId: number | null
  tabIndex: number | null
  lastAccessedAt: string | null
  suspendedState: TabSuspendedState | null
  status: "open"
  type: string
  firstSeenAt: string
  lastSeenAt: string
  createdAt: string
  updatedAt: string
}

export interface TabUpdate {
  id: string
  values: {
    chromeId: string
    url: string
    title: string
    domain: string | null
    faviconUrl: string | null
    windowId: number | null
    tabIndex: number | null
    lastAccessedAt: string | null
    suspendedState: TabSuspendedState | null
    lastSeenAt: string
    updatedAt: string
  }
}

export interface ReconcilePlan {
  inserts: TabInsert[]
  updates: TabUpdate[]
  /** Ids of open rows that matched nothing this sync and must be closed */
  closes: string[]
  ogFetch: { id: string; url: string }[]
  tweetFetch: { id: string; url: string }[]
}

export function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

export function suspendedStateOf(t: ChromeTab): TabSuspendedState | null {
  if (t.discarded) return "discarded"
  if (t.frozen) return "frozen"
  return null
}

/**
 * Decides what a Chrome snapshot means for the stored open-tab set, without
 * touching the database: which rows to insert, update, close, and which to
 * queue for OG/tweet enrichment.
 *
 * Split out of syncTabsFromList so the decision logic is testable offline —
 * the caller executes the returned plan inside its transaction. Kept pure:
 * `now` and `newId` are injected so a plan is fully determined by its inputs.
 */
export function reconcileTabs(
  dbTabs: ReconcileTab[],
  chromeTabs: ChromeTab[],
  { now, newId = nanoid }: { now: string; newId?: () => string },
): ReconcilePlan {
  const plan: ReconcilePlan = {
    inserts: [],
    updates: [],
    closes: [],
    ogFetch: [],
    tweetFetch: [],
  }

  const chromeIdSet = new Set(chromeTabs.map((t) => t.id))
  const dbChromeIdMap = new Map(dbTabs.map((t) => [t.chromeId, t]))

  // Rebind pass: when Chrome restarts (or after data recovery), every tab id
  // changes at once. Rebind by exact URL match instead of closing and
  // reinserting all tabs. Open rows with a null chromeId are candidates too.
  const missingByUrl = new Map<string, ReconcileTab[]>()
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
    // shift() so each candidate row is claimed at most once — two chrome tabs
    // sharing a URL must not both rebind onto the same row.
    const dbTab = missingByUrl.get(chromeTab.url)?.shift()
    if (dbTab) {
      reboundDbIds.add(dbTab.id)
      dbChromeIdMap.set(chromeTab.id, dbTab)
    }
  }

  for (const chromeTab of chromeTabs) {
    const existing = dbChromeIdMap.get(chromeTab.id)
    const domain = extractDomain(chromeTab.url)

    if (existing) {
      plan.updates.push({
        id: existing.id,
        values: {
          chromeId: chromeTab.id,
          url: chromeTab.url,
          title: chromeTab.title,
          domain,
          faviconUrl: chromeTab.faviconUrl || existing.faviconUrl,
          windowId: chromeTab.windowId ?? null,
          tabIndex: chromeTab.tabIndex ?? null,
          lastAccessedAt: chromeTab.lastAccessedAt ?? existing.lastAccessedAt,
          suspendedState: suspendedStateOf(chromeTab),
          lastSeenAt: now,
          updatedAt: now,
        },
      })

      // Queue enrichment: OG images for any http(s) tab never checked
      // (ogImage null; "" means checked-and-none) or whose URL changed.
      if (isTweetUrl(domain) && !existing.description) {
        plan.tweetFetch.push({ id: existing.id, url: chromeTab.url })
      } else if (
        /^https?:/i.test(chromeTab.url) &&
        (existing.ogImage === null || existing.url !== chromeTab.url)
      ) {
        plan.ogFetch.push({ id: existing.id, url: chromeTab.url })
      }
    } else {
      const id = newId()
      plan.inserts.push({
        id,
        chromeId: chromeTab.id,
        url: chromeTab.url,
        title: chromeTab.title,
        domain,
        faviconUrl: chromeTab.faviconUrl || null,
        windowId: chromeTab.windowId ?? null,
        tabIndex: chromeTab.tabIndex ?? null,
        lastAccessedAt: chromeTab.lastAccessedAt ?? null,
        suspendedState: suspendedStateOf(chromeTab),
        status: "open",
        type: chromeTab.type,
        firstSeenAt: now,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      })

      if (isTweetUrl(domain)) {
        plan.tweetFetch.push({ id, url: chromeTab.url })
      } else if (/^https?:/i.test(chromeTab.url)) {
        plan.ogFetch.push({ id, url: chromeTab.url })
      }
    }
  }

  // Close every open row that matched nothing this sync — by chromeId or
  // rebind — so the DB "open" set mirrors Chrome even for null-chromeId rows.
  for (const dbTab of dbTabs) {
    if ((!dbTab.chromeId || !chromeIdSet.has(dbTab.chromeId)) && !reboundDbIds.has(dbTab.id)) {
      plan.closes.push(dbTab.id)
    }
  }

  return plan
}
