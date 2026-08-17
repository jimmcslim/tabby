import { getDb } from "@/lib/db"
import { settings } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { NextRequest, NextResponse } from "next/server"

const SYNC_INTERVAL_KEY = "sync_interval_seconds"
const DEFAULT_SYNC_INTERVAL_SECONDS = 30
const MIN_SYNC_INTERVAL_SECONDS = 5
const MAX_SYNC_INTERVAL_SECONDS = 3600

function clampInterval(seconds: number): number {
  return Math.min(
    MAX_SYNC_INTERVAL_SECONDS,
    Math.max(MIN_SYNC_INTERVAL_SECONDS, Math.floor(seconds)),
  )
}

export async function GET() {
  const db = await getDb()
  const row = db.select().from(settings).where(eq(settings.key, SYNC_INTERVAL_KEY)).get()

  const parsed = row?.value != null ? Number(row.value) : NaN
  const syncIntervalSeconds = Number.isFinite(parsed)
    ? clampInterval(parsed)
    : DEFAULT_SYNC_INTERVAL_SECONDS

  return NextResponse.json({ syncIntervalSeconds })
}

export async function PUT(request: NextRequest) {
  const db = await getDb()
  const { syncIntervalSeconds } = await request.json()

  if (typeof syncIntervalSeconds !== "number" || !Number.isFinite(syncIntervalSeconds)) {
    return NextResponse.json(
      { error: "syncIntervalSeconds must be a finite number" },
      { status: 400 },
    )
  }

  const value = clampInterval(syncIntervalSeconds)

  db.insert(settings)
    .values({ key: SYNC_INTERVAL_KEY, value: String(value) })
    .onConflictDoUpdate({ target: settings.key, set: { value: String(value) } })
    .run()

  return NextResponse.json({ syncIntervalSeconds: value })
}
