import { getDb } from "@/lib/db"
import { sessions, sessionTabs } from "@/lib/db/schema"
import { openSuspendedTab } from "@/lib/chrome/actions"
import {
  acquireRestoreLock,
  releaseRestoreLock,
  setRestoreProgress,
  clearRestoreProgress,
} from "@/lib/extension/bridge"
import { syncTabs } from "@/lib/chrome/sync"
import { eq, asc } from "drizzle-orm"
import { NextRequest, NextResponse } from "next/server"

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const db = await getDb()
  const { sessionId } = await params

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 })

  const tabs = await db
    .select()
    .from(sessionTabs)
    .where(eq(sessionTabs.sessionId, sessionId))
    .orderBy(asc(sessionTabs.position))

  // Suppress the heavy per-tab sync pipeline while we reopen tabs in bulk;
  // refreshed each batch so a large restore keeps the lock alive, released in
  // finally so a failure can't wedge sync.
  let restored = 0
  acquireRestoreLock()
  setRestoreProgress(tabs.length, 0)
  try {
    // Batch 5 at a time to avoid overwhelming Chrome
    for (let i = 0; i < tabs.length; i += 5) {
      acquireRestoreLock()
      const batch = tabs.slice(i, i + 5)
      await Promise.all(
        batch.map(async (t) => {
          try {
            await openSuspendedTab(t.url, t.title ?? undefined, t.faviconUrl ?? undefined)
            restored++
          } catch {
            // Skip tabs that fail to open
          }
        }),
      )
      setRestoreProgress(tabs.length, restored)
    }
  } finally {
    releaseRestoreLock()
    try {
      // Bring the DB current the moment restore finishes, rather than waiting
      // on the extension's own debounced/watchdog snapshot timing.
      await syncTabs()
    } catch (e) {
      // Best effort — the next periodic/watchdog sync will catch up. Logged
      // (not silently swallowed) since a stuck gap here is exactly what let
      // a later restart snapshot a stale "Latest" into "Previous Session".
      console.error("[restore] post-restore sync failed:", e)
    }
    clearRestoreProgress()
  }

  return NextResponse.json({ restored, total: tabs.length })
}
