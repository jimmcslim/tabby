/**
 * Keyset paging for GET /api/tabs. Rows are ordered `lastSeenAt DESC, id DESC`
 * (the id tiebreaker makes the order total, so a page boundary can never skip
 * or repeat rows that share a timestamp), and the cursor is the last row of
 * the previous page.
 */

export const DEFAULT_PAGE_SIZE = 100
export const MAX_PAGE_SIZE = 500

export interface TabCursor {
  lastSeenAt: string
  id: string
}

/** Opaque to clients; URL-safe. */
export function encodeCursor(cursor: TabCursor): string {
  return Buffer.from(JSON.stringify([cursor.lastSeenAt, cursor.id])).toString("base64url")
}

/** The cursor in `value`, or null if it is missing or malformed. */
export function decodeCursor(value: string | null): TabCursor | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    ) {
      return { lastSeenAt: parsed[0], id: parsed[1] }
    }
  } catch {
    // fall through
  }
  return null
}

/** A page size from a query param: default when absent/invalid, clamped to 1..MAX_PAGE_SIZE. */
export function parsePageSize(value: string | null): number {
  const n = Number.parseInt(value ?? "", 10)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PAGE_SIZE
  return Math.min(n, MAX_PAGE_SIZE)
}
