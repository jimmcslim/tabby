import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * GET /api/tabs/[tabId]/screenshot against a scratch SQLite file and a scratch
 * screenshot dir (never data/): own capture, then another tab row's capture for
 * the same URL, then the OG image, then 404.
 */

let scratchDir: string
let GET: typeof import("./route").GET

const jpeg = (label: string) => Buffer.from(`jpeg:${label}`)

beforeAll(async () => {
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabby-shot-"))
  // lib/db and lib/screenshots read these at import time, so set them first.
  process.env.DATABASE_PATH = path.join(scratchDir, "tabby.db")
  process.env.SCREENSHOT_DIR = path.join(scratchDir, "screenshots")
  const { getDb } = await import("@/lib/db")
  const { tabs } = await import("@/lib/db/schema")
  const db = await getDb()
  const row = (id: string, url: string, updatedAt: string, ogImage: string | null = null) => ({
    id,
    url,
    ogImage,
    status: "open",
    type: "page",
    firstSeenAt: updatedAt,
    lastSeenAt: updatedAt,
    createdAt: updatedAt,
    updatedAt,
  })
  await db.insert(tabs).values([
    // own capture wins over a newer duplicate's
    row("own", "https://a.test/", "2026-01-01T00:00:00Z"),
    row("own-dup", "https://a.test/", "2026-02-01T00:00:00Z"),
    // no own capture; two captured duplicates, newest should win
    row("orphan", "https://b.test/", "2026-03-01T00:00:00Z", "https://og.test/b.png"),
    row("b-old", "https://b.test/", "2026-01-01T00:00:00Z"),
    row("b-new", "https://b.test/", "2026-02-01T00:00:00Z"),
    // newest duplicate has no file; falls to the newest that does
    row("c-open", "https://c.test/", "2026-03-01T00:00:00Z"),
    row("c-nofile", "https://c.test/", "2026-02-01T00:00:00Z"),
    row("c-file", "https://c.test/", "2026-01-01T00:00:00Z"),
    // nothing captured anywhere, but OG
    row("og-only", "https://d.test/", "2026-01-01T00:00:00Z", "https://og.test/d.png"),
    // nothing at all
    row("nothing", "https://e.test/", "2026-01-01T00:00:00Z"),
  ])
  const { ensureScreenshotDir, screenshotPath } = await import("@/lib/screenshots")
  ensureScreenshotDir()
  for (const id of ["own", "own-dup", "b-old", "b-new", "c-file"]) {
    fs.writeFileSync(screenshotPath(id), jpeg(id))
  }
  ;({ GET } = await import("./route"))
})

afterAll(() => {
  // lib/db caches its connection for the whole `bun test` process, and other
  // route tests share it, so the scratch DB dir can only go at process exit.
  fs.rmSync(process.env.SCREENSHOT_DIR!, { recursive: true, force: true })
  process.once("exit", () => fs.rmSync(scratchDir, { recursive: true, force: true }))
})

async function get(tabId: string) {
  const { NextRequest } = await import("next/server")
  return GET(new NextRequest(`http://localhost/api/tabs/${tabId}/screenshot`), {
    params: Promise.resolve({ tabId }),
  })
}

describe("GET /api/tabs/[tabId]/screenshot", () => {
  it("serves the tab's own capture even when a newer duplicate has one", async () => {
    const res = await get("own")
    expect(res.status).toBe(200)
    expect(Buffer.from(await res.arrayBuffer())).toEqual(jpeg("own"))
  })

  it("falls back to the most recently updated same-URL tab that has a capture", async () => {
    const res = await get("orphan")
    expect(res.status).toBe(200)
    expect(Buffer.from(await res.arrayBuffer())).toEqual(jpeg("b-new"))
  })

  it("skips same-URL tabs that have no capture file", async () => {
    const res = await get("c-open")
    expect(Buffer.from(await res.arrayBuffer())).toEqual(jpeg("c-file"))
  })

  it("redirects to the OG image when no tab with that URL has a capture", async () => {
    const res = await get("og-only")
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe("https://og.test/d.png")
  })

  it("404s when there is no capture and no OG image", async () => {
    expect((await get("nothing")).status).toBe(404)
  })
})
