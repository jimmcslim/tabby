import { getDb } from "@/lib/db"
import { tabs, sessions, sessionTabs } from "@/lib/db/schema"
import { and, eq } from "drizzle-orm"
import { nanoid } from "nanoid"

/**
 * Overwrites the rolling "Latest" auto-session with the currently open tabs.
 * When `isStartup` is true (first sync after chrome.runtime.onStartup), the
 * pre-overwrite contents of "Latest" are copied into a second rolling
 * "Previous Session" row first, in the same transaction — this is what makes
 * the pre-restart tab set recoverable after Chrome quits or crashes.
 */
export async function syncAutoSessions(isStartup: boolean): Promise<void> {
  const db = await getDb()
  const now = new Date().toISOString()

  db.transaction((tx) => {
    if (isStartup) {
      const latest = tx
        .select()
        .from(sessions)
        .where(and(eq(sessions.isAuto, true), eq(sessions.isPrevious, false)))
        .get()

      if (latest) {
        const latestTabs = tx
          .select()
          .from(sessionTabs)
          .where(eq(sessionTabs.sessionId, latest.id))
          .all()

        if (latestTabs.length > 0) {
          let previous = tx
            .select()
            .from(sessions)
            .where(and(eq(sessions.isAuto, true), eq(sessions.isPrevious, true)))
            .get()

          if (!previous) {
            previous = {
              id: nanoid(),
              name: "Previous Session",
              isAuto: true,
              isPrevious: true,
              tabCount: 0,
              createdAt: now,
              updatedAt: now,
            }
            tx.insert(sessions).values(previous).run()
          }

          tx.delete(sessionTabs).where(eq(sessionTabs.sessionId, previous.id)).run()
          tx.insert(sessionTabs)
            .values(
              latestTabs.map((t, i) => ({
                id: nanoid(),
                sessionId: previous!.id,
                url: t.url,
                title: t.title,
                domain: t.domain,
                faviconUrl: t.faviconUrl,
                category: t.category,
                position: i,
              })),
            )
            .run()

          tx.update(sessions)
            .set({ tabCount: latestTabs.length, updatedAt: now })
            .where(eq(sessions.id, previous.id))
            .run()
        }
      }
    }

    const openTabs = tx.select().from(tabs).where(eq(tabs.status, "open")).all()

    // Find or create the "Latest" auto-session
    let latestSession = tx
      .select()
      .from(sessions)
      .where(and(eq(sessions.isAuto, true), eq(sessions.isPrevious, false)))
      .get()

    if (!latestSession) {
      latestSession = {
        id: nanoid(),
        name: "Latest",
        isAuto: true,
        isPrevious: false,
        tabCount: 0,
        createdAt: now,
        updatedAt: now,
      }
      tx.insert(sessions).values(latestSession).run()
    }

    // Full-replace session tabs
    tx.delete(sessionTabs).where(eq(sessionTabs.sessionId, latestSession.id)).run()

    if (openTabs.length > 0) {
      tx.insert(sessionTabs)
        .values(
          openTabs.map((t, i) => ({
            id: nanoid(),
            sessionId: latestSession!.id,
            url: t.url,
            title: t.title,
            domain: t.domain,
            faviconUrl: t.faviconUrl,
            category: t.category,
            position: i,
          })),
        )
        .run()
    }

    tx.update(sessions)
      .set({ tabCount: openTabs.length, updatedAt: now })
      .where(eq(sessions.id, latestSession.id))
      .run()
  })
}

export async function updateAutoSession(): Promise<void> {
  await syncAutoSessions(false)
}
