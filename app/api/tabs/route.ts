import { getDb } from "@/lib/db"
import { tabs } from "@/lib/db/schema"
import { eq, and, or, desc, sql } from "drizzle-orm"
import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  const db = await getDb()
  const { searchParams } = request.nextUrl
  const status = searchParams.get("status") || "open"
  const category = searchParams.get("category")
  const search = searchParams.get("search")

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

  const result = await db
    .select()
    .from(tabs)
    .where(and(...conditions))
    .orderBy(desc(tabs.lastSeenAt))

  return NextResponse.json(result)
}
