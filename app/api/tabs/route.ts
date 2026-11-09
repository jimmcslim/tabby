import { getDb } from "@/lib/db"
import { tabs } from "@/lib/db/schema"
import { eq, and, or, desc, lt, sql } from "drizzle-orm"
import { NextRequest, NextResponse } from "next/server"
import { decodeCursor, encodeCursor, parsePageSize } from "@/lib/tabs/paging"

export async function GET(request: NextRequest) {
  const db = await getDb()
  const { searchParams } = request.nextUrl
  const status = searchParams.get("status") || "open"
  const category = searchParams.get("category")
  const search = searchParams.get("search")
  // Paged mode is opt-in (`limit` and/or `cursor`) and returns
  // `{ tabs, nextCursor }`; without either, the response is the plain array
  // every existing caller expects.
  const paged = searchParams.has("limit") || searchParams.has("cursor")

  const conditions = [eq(tabs.status, status)]
  if (category) conditions.push(eq(tabs.category, category))
  if (search) {
    // Same rule as filterTabs in lib/tabs/search.ts: case-insensitive, literal
    // substring of the title or of the URL minus its http(s):// scheme. instr()
    // (not LIKE) so `%` and `_` in the query aren't treated as wildcards.
    const needle = search.toLowerCase()
    const urlWithoutScheme = sql`(case
      when lower(${tabs.url}) like 'https://%' then substr(${tabs.url}, 9)
      when lower(${tabs.url}) like 'http://%' then substr(${tabs.url}, 8)
      else ${tabs.url} end)`
    conditions.push(
      or(
        sql`instr(lower(${tabs.title}), ${needle}) > 0`,
        sql`instr(lower(${urlWithoutScheme}), ${needle}) > 0`,
      )!,
    )
  }

  if (!paged) {
    const result = await db
      .select()
      .from(tabs)
      .where(and(...conditions))
      .orderBy(desc(tabs.lastSeenAt), desc(tabs.id))
    return NextResponse.json(result)
  }

  const cursor = decodeCursor(searchParams.get("cursor"))
  if (searchParams.get("cursor") && !cursor) {
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400 })
  }
  if (cursor) {
    // Keyset: strictly after the cursor row in (lastSeenAt DESC, id DESC) order.
    conditions.push(
      or(
        lt(tabs.lastSeenAt, cursor.lastSeenAt),
        and(eq(tabs.lastSeenAt, cursor.lastSeenAt), lt(tabs.id, cursor.id)),
      )!,
    )
  }

  const limit = parsePageSize(searchParams.get("limit"))
  // One extra row tells us whether another page exists.
  const rows = await db
    .select()
    .from(tabs)
    .where(and(...conditions))
    .orderBy(desc(tabs.lastSeenAt), desc(tabs.id))
    .limit(limit + 1)

  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  const nextCursor =
    rows.length > limit && last ? encodeCursor({ lastSeenAt: last.lastSeenAt, id: last.id }) : null
  return NextResponse.json({ tabs: page, nextCursor })
}
