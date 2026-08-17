import { getDb } from "@/lib/db"
import { sessions, sessionTabs } from "@/lib/db/schema"
import { eq, asc } from "drizzle-orm"
import { NextRequest, NextResponse } from "next/server"

type Params = { params: Promise<{ sessionId: string }> }

export async function GET(_request: NextRequest, { params }: Params) {
  const db = await getDb()
  const { sessionId } = await params

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 })

  const tabs = await db
    .select()
    .from(sessionTabs)
    .where(eq(sessionTabs.sessionId, sessionId))
    .orderBy(asc(sessionTabs.position))

  return NextResponse.json({ ...session, tabs })
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const db = await getDb()
  const { sessionId } = await params
  const { name } = await request.json()

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 })
  if (session.isAuto) return NextResponse.json({ error: "Cannot rename auto-session" }, { status: 400 })

  const now = new Date().toISOString()
  await db
    .update(sessions)
    .set({ name: name.trim(), updatedAt: now })
    .where(eq(sessions.id, sessionId))

  const [updated] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
  return NextResponse.json(updated)
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const db = await getDb()
  const { sessionId } = await params

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 })
  if (session.isAuto) return NextResponse.json({ error: "Cannot delete auto-session" }, { status: 400 })

  await db.delete(sessions).where(eq(sessions.id, sessionId))
  return NextResponse.json({ success: true })
}
