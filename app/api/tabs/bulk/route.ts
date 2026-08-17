import { getDb } from "@/lib/db"
import { tabs } from "@/lib/db/schema"
import { closeTab } from "@/lib/chrome/actions"
import { inArray, eq } from "drizzle-orm"
import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  const db = await getDb()
  const { tabIds, action } = await request.json()

  if (!tabIds || !Array.isArray(tabIds)) {
    return NextResponse.json({ error: "tabIds array required" }, { status: 400 })
  }

  const now = new Date().toISOString()

  switch (action) {
    case "close": {
      const tabsToClose = await db.select().from(tabs).where(inArray(tabs.id, tabIds))
      let closed = 0
      for (const tab of tabsToClose) {
        if (tab.chromeId) {
          try {
            await closeTab(tab.chromeId)
            await db
              .update(tabs)
              .set({ status: "closed", closedAt: now, chromeId: null, updatedAt: now })
              .where(eq(tabs.id, tab.id))
            closed++
          } catch { /* skip */ }
        }
      }
      return NextResponse.json({ closed })
    }
    case "delete": {
      await db.delete(tabs).where(inArray(tabs.id, tabIds))
      return NextResponse.json({ deleted: tabIds.length })
    }
    default:
      return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  }
}
