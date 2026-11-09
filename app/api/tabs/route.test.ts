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
  const res = await GET(new NextRequest(`http://localhost/api/tabs?${query}&limit=500`))
  return ((await res.json()) as { tabs: { id: string }[] }).tabs.map((t) => t.id).sort()
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

describe("GET /api/tabs paging", () => {
  type Paged = { tabs: { id: string }[]; nextCursor: string | null }

  async function page(query: string): Promise<Paged> {
    const { NextRequest } = await import("next/server")
    const res = await GET(new NextRequest(`http://localhost/api/tabs?${query}`))
    return (await res.json()) as Paged
  }

  /** Walk every page of `query` at `limit`, returning ids in order. */
  async function walk(query: string, limit: number): Promise<string[]> {
    const seen: string[] = []
    let cursor: string | null = null
    for (let i = 0; i < 50; i++) {
      const p: Paged = await page(`${query}&limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`)
      seen.push(...p.tabs.map((t) => t.id))
      if (!p.nextCursor) return seen
      cursor = p.nextCursor
    }
    throw new Error("paging did not terminate")
  }

  beforeAll(async () => {
    const { getDb } = await import("@/lib/db")
    const { tabs } = await import("@/lib/db/schema")
    const db = await getDb()
    // 7 closed tabs; five share a timestamp so the id tiebreaker matters.
    const rows = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"].map((id, i) => {
      const ts = i < 5 ? "2026-02-01T00:00:00.000Z" : `2026-02-0${i}T00:00:00.000Z`
      return {
        id,
        url: `https://paging.test/${id}`,
        title: id === "p3" || id === "p6" ? "needle" : "hay",
        status: "closed",
        type: "page",
        firstSeenAt: ts,
        lastSeenAt: ts,
        createdAt: ts,
        updatedAt: ts,
      }
    })
    await db.insert(tabs).values(rows)
  })

  it("always returns a page, even with no paging params (default size, first page)", async () => {
    const { NextRequest } = await import("next/server")
    const res = await GET(new NextRequest("http://localhost/api/tabs?status=closed&search=paging.test"))
    const body = (await res.json()) as Paged
    expect(Array.isArray(body)).toBe(false)
    expect(body.tabs).toHaveLength(7)
    expect(body.nextCursor).toBeNull()
  })

  it("returns a page and a cursor, newest first, then null at the end", async () => {
    const first = await page("status=closed&search=paging.test&limit=3")
    expect(first.tabs).toHaveLength(3)
    expect(first.nextCursor).not.toBeNull()
    const all = await walk("status=closed&search=paging.test", 3)
    expect(all).toHaveLength(7)
    expect(new Set(all).size).toBe(7)
  })

  it("has no gaps or duplicates across page boundaries, even with identical timestamps", async () => {
    const expected = await walk("status=closed&search=paging.test", 100)
    for (const size of [1, 2, 3, 4, 6]) {
      expect(await walk("status=closed&search=paging.test", size)).toEqual(expected)
    }
    // lastSeenAt DESC then id DESC: the two later days, then p5..p1.
    expect(expected).toEqual(["p7", "p6", "p5", "p4", "p3", "p2", "p1"])
  })

  it("combines search with paging", async () => {
    expect(await walk("status=closed&search=needle", 1)).toEqual(["p6", "p3"])
  })

  it("reports no more pages when the result fits exactly", async () => {
    const p = await page("status=closed&search=needle&limit=2")
    expect(p.tabs.map((t) => t.id)).toEqual(["p6", "p3"])
    expect(p.nextCursor).toBeNull()
  })

  it("rejects a malformed cursor", async () => {
    const { NextRequest } = await import("next/server")
    const res = await GET(new NextRequest("http://localhost/api/tabs?status=closed&limit=5&cursor=garbage!!"))
    expect(res.status).toBe(400)
  })
})
