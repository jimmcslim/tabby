import { openTab } from "@/lib/chrome/actions"
import { getDb } from "@/lib/db"
import { tabs } from "@/lib/db/schema"
import { nanoid } from "nanoid"
import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  const db = await getDb()
  const { url, windowId } = await request.json()

  try {
    const chromeTab = await openTab(
      url || undefined,
      typeof windowId === "number" ? windowId : undefined,
    )
    const now = new Date().toISOString()
    const finalUrl = chromeTab.url || url || "chrome://newtab/"
    const domain = (() => {
      try { return new URL(finalUrl).hostname } catch { return null }
    })()

    const newTab = {
      id: nanoid(),
      chromeId: chromeTab.id,
      url: finalUrl,
      title: chromeTab.title || finalUrl,
      domain,
      faviconUrl: chromeTab.faviconUrl || null,
      windowId: chromeTab.windowId ?? null,
      status: "open" as const,
      type: "page",
      firstSeenAt: now,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    }

    db.insert(tabs).values(newTab).run()
    return NextResponse.json(newTab)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to open tab"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
