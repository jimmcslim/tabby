import { getDb } from "@/lib/db"
import { tabs } from "@/lib/db/schema"
import { ensureScreenshotDir, screenshotPath } from "@/lib/screenshots"
import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import fs from "node:fs"

/**
 * Receives a JPEG capture of the visible tab from the extension
 * (chrome.tabs.captureVisibleTab on tab activation) and stores it in the
 * screenshot cache under the DB tab id.
 */
export async function POST(request: Request) {
  try {
    const { tabId, dataUrl } = (await request.json()) as { tabId?: string; dataUrl?: string }
    if (!tabId || typeof dataUrl !== "string") {
      return NextResponse.json({ error: "tabId and dataUrl required" }, { status: 400 })
    }

    const match = dataUrl.match(/^data:image\/jpeg;base64,(.+)$/)
    if (!match) {
      return NextResponse.json({ error: "Expected a JPEG data URL" }, { status: 400 })
    }

    const db = await getDb()
    const tab = db.select().from(tabs).where(eq(tabs.chromeId, tabId)).get()
    if (!tab || tab.status !== "open") {
      // Tab not synced yet (or already closed) — nothing to attach the capture to
      return NextResponse.json({ stored: false })
    }

    ensureScreenshotDir()
    fs.writeFileSync(screenshotPath(tab.id), Buffer.from(match[1], "base64"))
    return NextResponse.json({ stored: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Screenshot store failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
