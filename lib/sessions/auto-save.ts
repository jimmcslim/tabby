import type { Tx } from "@/lib/db"
import { sessions, sessionTabs, tabs } from "@/lib/db/schema"
import { and, eq } from "drizzle-orm"
import { nanoid } from "nanoid"

type OpenTab = {
  url: string
  title: string | null
  domain: string | null
  faviconUrl: string | null
  category: string | null
}

/**
 * Overwrites the rolling "Latest" auto-session with the currently open tabs
 * (read fresh from `tabs`, within the caller's transaction). When `isStartup`
 * is true, `previousOpenTabs` — the tabs that were open *before* this sync's
 * mutations ran — is copied into a rolling "Previous Session" first, making
 * the pre-restart tab set recoverable after Chrome quits or crashes.
 *
 * Must run inside the same transaction as the tab upserts/closes it follows
 * (see syncTabsFromList). `previousOpenTabs` is supplied by the caller rather
 * than re-derived from the "Latest" mirror precisely so a prior sync's mirror
 * write can never desync from what was actually open: mirror and tab-state
 * changes now commit together or not at all.
 */
export function syncAutoSessions(tx: Tx, isStartup: boolean, previousOpenTabs: OpenTab[]): void {
  const now = new Date().toISOString()

  if (isStartup && previousOpenTabs.length > 0) {
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
        previousOpenTabs.map((t, i) => ({
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
      .set({ tabCount: previousOpenTabs.length, updatedAt: now })
      .where(eq(sessions.id, previous.id))
      .run()
  }

  const openTabs = tx.select().from(tabs).where(eq(tabs.status, "open")).all()

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
}
