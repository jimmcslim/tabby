import { getDb } from "@/lib/db"
import { tabs } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { NextRequest, NextResponse } from "next/server"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tabId: string }> },
) {
  const db = await getDb()
  const { tabId } = await params
  const body = await request.json()
  const now = new Date().toISOString()

  await db
    .update(tabs)
    .set({ ...body, updatedAt: now })
    .where(eq(tabs.id, tabId))

  const [updated] = await db.select().from(tabs).where(eq(tabs.id, tabId)).limit(1)
  return NextResponse.json(updated)
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ tabId: string }> },
) {
  const db = await getDb()
  const { tabId } = await params
  await db.delete(tabs).where(eq(tabs.id, tabId))
  return NextResponse.json({ success: true })
}
