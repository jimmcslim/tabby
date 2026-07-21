import { getDb } from "@/lib/db"
import { sessions, sessionTabs } from "@/lib/db/schema"
import { openTab } from "@/lib/chrome/actions"
import { acquireRestoreLock, releaseRestoreLock } from "@/lib/extension/bridge"
import { eq, asc } from "drizzle-orm"
import { NextRequest, NextResponse } from "next/server"

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const db = await getDb()
  const { sessionId } = await params

  const session = db.select().from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 })

  const tabs = db
    .select()
    .from(sessionTabs)
    .where(eq(sessionTabs.sessionId, sessionId))
    .orderBy(asc(sessionTabs.position))
    .all()

  // Suppress the heavy per-tab sync pipeline while we reopen tabs in bulk;
  // refreshed each batch so a large restore keeps the lock alive, released in
  // finally so a failure can't wedge sync.
  let restored = 0
  acquireRestoreLock()
  try {
    // Batch 5 at a time to avoid overwhelming Chrome
    for (let i = 0; i < tabs.length; i += 5) {
      acquireRestoreLock()
      const batch = tabs.slice(i, i + 5)
      await Promise.all(
        batch.map(async (t) => {
          try {
            await openTab(t.url)
            restored++
          } catch {
            // Skip tabs that fail to open
          }
        }),
      )
    }
  } finally {
    releaseRestoreLock()
  }

  return NextResponse.json({ restored, total: tabs.length })
}
