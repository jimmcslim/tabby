import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * GET /api/tabs?search= against a scratch SQLite file (never data/tabby.db):
 * the server must match title-or-URL exactly like filterTabs in
 * lib/tabs/search.ts, so History and the Dashboard agree.
 */

let scratchDir: string
let GET: typeof import("./route").GET

beforeAll(async () => {
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabby-route-"))
  // lib/db reads DATABASE_PATH at import time, so set it first.
  process.env.DATABASE_PATH = path.join(scratchDir, "tabby.db")
  const { getDb } = await import("@/lib/db")
  const { tabs } = await import("@/lib/db/schema")
  const db = await getDb()
  const now = new Date().toISOString()
  const row = (id: string, title: string | null, url: string, status = "open") => ({
    id,
    url,
    title,
    status,
    type: "page",
    firstSeenAt: now,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(tabs).values([
    row("hn", "Hacker News", "https://news.ycombinator.com/item?id=1"),
    row("other", "Something else", "http://example.org/path"),
    row("untitled", null, "https://docs.bun.sh/"),
    row("pct", "100% sure", "https://example.net/a_b"),
    row("closed-hn", "Old thread", "https://news.ycombinator.com/item?id=2", "closed"),
  ])
  ;({ GET } = await import("./route"))
})

afterAll(() => {
  fs.rmSync(scratchDir, { recursive: true, force: true })
})

async function ids(query: string): Promise<string[]> {
  const { NextRequest } = await import("next/server")
  const res = await GET(new NextRequest(`http://localhost/api/tabs?${query}`))
  return ((await res.json()) as { id: string }[]).map((t) => t.id).sort()
}

describe("GET /api/tabs ?search=", () => {
  it("matches the URL even when the title doesn't contain the text", async () => {
    expect(await ids("status=open&search=news.ycombinator")).toEqual(["hn"])
    expect(await ids("status=closed&search=news.ycombinator")).toEqual(["closed-hn"])
  })

  it("still matches the title, case-insensitively", async () => {
    expect(await ids("status=open&search=HACKER")).toEqual(["hn"])
  })

  it("matches a tab with no title by URL", async () => {
    expect(await ids("status=open&search=docs.bun")).toEqual(["untitled"])
  })

  it("does not match every tab on the scheme", async () => {
    expect(await ids("status=open&search=http")).toEqual([])
    expect(await ids("status=open&search=https://")).toEqual([])
  })

  it("treats % and _ literally rather than as wildcards", async () => {
    expect(await ids("status=open&search=%25")).toEqual(["pct"])
    expect(await ids("status=open&search=a_b")).toEqual(["pct"])
    expect(await ids("status=open&search=a_c")).toEqual([])
  })

  it("returns everything for the status when there is no search", async () => {
    expect(await ids("status=open")).toEqual(["hn", "other", "pct", "untitled"])
  })
})
