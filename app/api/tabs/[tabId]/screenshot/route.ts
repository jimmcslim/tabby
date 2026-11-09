import { enqueueCapture } from "@/lib/capture"
import { getDb } from "@/lib/db"
import { tabs } from "@/lib/db/schema"
import { ensureScreenshotDir, screenshotPath } from "@/lib/screenshots"
import { eq } from "drizzle-orm"
import { NextRequest, NextResponse } from "next/server"
import fs from "node:fs"

function jpegResponse(data: Buffer | Uint8Array, maxAge: number) {
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": `public, max-age=${maxAge}`,
    },
  })
}

/**
 * Serves the cached tab preview. Captures arrive from the extension
 * (POST /api/extension/screenshot) whenever a tab is activated; this route
 * never captures inline: on a total miss it only enqueues the tab for the
 * background capture drain (lib/capture).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tabId: string }> },
) {
  const { tabId } = await params

  ensureScreenshotDir()
  const filePath = screenshotPath(tabId)

  if (fs.existsSync(filePath)) {
    return jpegResponse(fs.readFileSync(filePath), 300)
  }

  // No capture yet — fall back to the OG image if the tab has one
  const db = await getDb()
  const [tab] = await db.select().from(tabs).where(eq(tabs.id, tabId)).limit(1)
  if (tab?.ogImage) {
    return NextResponse.redirect(tab.ogImage, { status: 302 })
  }

  // Nothing to show: queue a background server-side capture (no-op unless a
  // capture backend is configured). The next request finds the file.
  if (tab) enqueueCapture(tab.id)

  return NextResponse.json({ error: "No screenshot available" }, { status: 404 })
}
