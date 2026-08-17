import { getDb } from "@/lib/db"
import { settings } from "@/lib/db/schema"
import { eq, like } from "drizzle-orm"
import { NextRequest, NextResponse } from "next/server"

const PREFIX = "window_name:"

export async function GET() {
  const db = await getDb()
  const rows = await db.select().from(settings).where(like(settings.key, `${PREFIX}%`))

  const names: Record<string, string> = {}
  for (const row of rows) {
    const windowId = row.key.slice(PREFIX.length)
    if (row.value) names[windowId] = row.value
  }

  return NextResponse.json(names)
}

export async function PUT(request: NextRequest) {
  const db = await getDb()
  const { windowId, name } = await request.json()

  if (windowId == null || typeof name !== "string") {
    return NextResponse.json({ error: "windowId and name required" }, { status: 400 })
  }

  const key = `${PREFIX}${windowId}`
  const trimmed = name.trim()

  if (!trimmed) {
    await db.delete(settings).where(eq(settings.key, key))
  } else {
    await db
      .insert(settings)
      .values({ key, value: trimmed })
      .onConflictDoUpdate({ target: settings.key, set: { value: trimmed } })
  }

  return NextResponse.json({ windowId, name: trimmed || null })
}
