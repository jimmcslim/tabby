import { getDb } from "@/lib/db"
import { sessions, sessionTabs } from "@/lib/db/schema"
import { nanoid } from "nanoid"
import { NextRequest, NextResponse } from "next/server"

const BLOCKED_PROTOCOLS = ["javascript:", "data:", "vbscript:"]
const MAX_TABS = 1000

/**
 * The import payload as it arrives over the wire — every field is still
 * unverified, so the checks below stay even though the type says "string".
 */
interface ImportedTab {
  url?: string
  title?: string | null
  domain?: string | null
  faviconUrl?: string | null
  category?: string | null
  position?: number
}

interface SessionImport {
  version?: number
  session?: {
    name?: string
    createdAt?: string
    tabs?: ImportedTab[]
  }
}

export async function POST(request: NextRequest) {
  const db = await getDb()
  const body: SessionImport = await request.json()

  // Validate structure
  if (body.version !== 1) {
    return NextResponse.json({ error: "Unsupported export version" }, { status: 400 })
  }
  const payload = body.session
  if (!payload?.name || typeof payload.name !== "string") {
    return NextResponse.json({ error: "Session name is required" }, { status: 400 })
  }
  const importedTabs = payload.tabs
  if (!Array.isArray(importedTabs) || importedTabs.length === 0) {
    return NextResponse.json({ error: "Session must have at least one tab" }, { status: 400 })
  }
  if (importedTabs.length > MAX_TABS) {
    return NextResponse.json({ error: `Maximum ${MAX_TABS} tabs per session` }, { status: 400 })
  }

  // Validate URLs, keeping the narrowed tabs for the insert below
  const validTabs: (ImportedTab & { url: string })[] = []
  for (const tab of importedTabs) {
    const url = tab.url
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "Each tab must have a URL" }, { status: 400 })
    }
    if (BLOCKED_PROTOCOLS.some((p) => url.toLowerCase().startsWith(p))) {
      return NextResponse.json({ error: `Blocked URL protocol: ${url}` }, { status: 400 })
    }
    validTabs.push({ ...tab, url })
  }

  const now = new Date().toISOString()
  const session = {
    id: nanoid(),
    name: payload.name.trim(),
    isAuto: false,
    isPrevious: false,
    tabCount: importedTabs.length,
    createdAt: payload.createdAt || now,
    updatedAt: now,
  }

  await db.insert(sessions).values(session)

  await db.insert(sessionTabs).values(
    validTabs.map((t, i) => ({
      id: nanoid(),
      sessionId: session.id,
      url: t.url,
      title: t.title || null,
      domain: t.domain || null,
      faviconUrl: t.faviconUrl || null,
      category: t.category || null,
      position: t.position ?? i,
    })),
  )

  return NextResponse.json(session, { status: 201 })
}
