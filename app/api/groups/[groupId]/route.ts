import { getDb } from "@/lib/db"
import { groups } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { NextRequest, NextResponse } from "next/server"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const db = await getDb()
  const { groupId } = await params
  const body = await request.json()
  const now = new Date().toISOString()

  await db.update(groups).set({ ...body, updatedAt: now }).where(eq(groups.id, groupId))
  const [updated] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1)
  return NextResponse.json(updated)
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const db = await getDb()
  const { groupId } = await params
  await db.delete(groups).where(eq(groups.id, groupId))
  return NextResponse.json({ success: true })
}
