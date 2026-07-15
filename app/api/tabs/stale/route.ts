import { getDb } from "@/lib/db"
import { tabs } from "@/lib/db/schema"
import { discardTab } from "@/lib/chrome/actions"
import { eq, and, lt, isNull, sql } from "drizzle-orm"
import { NextRequest, NextResponse } from "next/server"

/**
 * GET: find open tabs not focused in a while. Uses lastAccessedAt (real focus
 * time from the extension) — lastSeenAt is refreshed on every sync so it can
 * never go stale. Already-suspended tabs are excluded.
 */
export async function GET(request: NextRequest) {
  const db = await getDb()
  const hours = parseInt(request.nextUrl.searchParams.get("hours") || "24", 10)
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()

  const staleTabs = db
    .select()
    .from(tabs)
    .where(
      and(
        eq(tabs.status, "open"),
        isNull(tabs.suspendedState),
        lt(sql`COALESCE(${tabs.lastAccessedAt}, ${tabs.firstSeenAt})`, cutoff),
      ),
    )
    .all()

  return NextResponse.json({ tabs: staleTabs, count: staleTabs.length, hours })
}

/** POST: suspend stale tabs (chrome.tabs.discard — kept open, memory freed) */
export async function POST(request: NextRequest) {
  const db = await getDb()
  const { tabIds } = await request.json()

  if (!tabIds || !Array.isArray(tabIds) || tabIds.length === 0) {
    return NextResponse.json({ error: "tabIds array required" }, { status: 400 })
  }

  const now = new Date().toISOString()
  let suspended = 0

  for (const tabId of tabIds) {
    const tab = db.select().from(tabs).where(eq(tabs.id, tabId)).get()
    if (!tab || tab.status !== "open" || !tab.chromeId) continue

    try {
      const newChromeId = await discardTab(tab.chromeId)
      db.update(tabs)
        .set({
          chromeId: newChromeId ?? tab.chromeId,
          suspendedState: "discarded",
          updatedAt: now,
        })
        .where(eq(tabs.id, tab.id))
        .run()
      suspended++
    } catch {
      // skip tabs that fail (active tab, extension offline, ...)
    }
  }

  return NextResponse.json({ suspended })
}
