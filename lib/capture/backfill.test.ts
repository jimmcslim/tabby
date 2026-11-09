import { describe, expect, it } from "bun:test"
import { parseBackfillArgs, planBackfill, runBackfill, type BackfillRow } from "./backfill"
import type { DrainStore, DrainTab } from "./drain"
import type { CaptureBackend, CaptureResult } from "./types"

const JPEG = new Uint8Array([0xff, 0xd8, 0xff])
const row = (id: string, o: Partial<BackfillRow> = {}): BackfillRow => ({
  id,
  url: `https://example.com/${id}`,
  ogImage: null,
  captureFailedAt: null,
  lastAccessedAt: null,
  firstSeenAt: "2026-01-01T00:00:00Z",
  status: "open",
  ...o,
})

describe("parseBackfillArgs", () => {
  it("defaults to a dry run", () => {
    expect(parseBackfillArgs([], {})).toEqual({ apply: false, limit: 15 })
  })
  it("--apply with no --limit uses CAPTURE_DRAIN_LIMIT", () => {
    expect(parseBackfillArgs(["--apply"], { CAPTURE_DRAIN_LIMIT: "7" })).toEqual({ apply: true, limit: 7 })
  })
  it("--limit overrides, in both forms", () => {
    expect(parseBackfillArgs(["--limit", "3"], {}).limit).toBe(3)
    expect(parseBackfillArgs(["--limit=4"], {}).limit).toBe(4)
  })
  it("rejects a bad limit and unknown flags", () => {
    expect(() => parseBackfillArgs(["--limit", "x"], {})).toThrow()
    expect(() => parseBackfillArgs(["--limit", "0"], {})).toThrow()
    expect(() => parseBackfillArgs(["--bogus"], {})).toThrow()
  })
})

describe("planBackfill", () => {
  it("orders by lastAccessedAt desc, nulls last, then firstSeenAt desc", () => {
    const plan = planBackfill(
      [
        row("old", { lastAccessedAt: "2026-01-01T00:00:00Z" }),
        row("never-old", { firstSeenAt: "2026-02-01T00:00:00Z" }),
        row("new", { lastAccessedAt: "2026-03-01T00:00:00Z" }),
        row("never-new", { firstSeenAt: "2026-04-01T00:00:00Z" }),
      ],
      () => false,
    )
    expect(plan.eligible).toEqual(["new", "old", "never-new", "never-old"])
  })
  it("skips tabs with a file, an OG image or a memoised failure, and counts why", () => {
    const plan = planBackfill(
      [row("a"), row("hasfile"), row("og", { ogImage: "x" }), row("failed", { captureFailedAt: "t" })],
      (id) => id === "hasfile",
    )
    expect(plan.eligible).toEqual(["a"])
    expect(plan.skipped).toEqual({ hasCapture: 1, hasOgImage: 1, previouslyFailed: 1, sameUrlCovered: 0 })
  })
  it("skips a tab whose URL is covered by another tab's capture (#54 reuse)", () => {
    const plan = planBackfill(
      [row("a", { url: "https://x.com/p" }), row("closed-dup", { url: "https://x.com/p" })],
      (id) => id === "closed-dup",
    )
    expect(plan.eligible).toEqual([])
    expect(plan.skipped.sameUrlCovered).toBe(1)
  })
  it("ignores closed tabs but lets their captures cover open duplicates", () => {
    const plan = planBackfill(
      [row("closed", { status: "closed" }), row("open", { url: "https://x.com/p" }), row("closed-dup", { status: "closed", url: "https://x.com/p" })],
      (id) => id === "closed-dup",
    )
    expect(plan.eligible).toEqual([])
    expect(plan.skipped.sameUrlCovered).toBe(1)
  })
  it("ignores closed tabs but lets their captures cover open duplicates", () => {
    const plan = planBackfill(
      [row("closed", { status: "closed" }), row("open", { url: "https://x.com/p" }), row("closed-dup", { status: "closed", url: "https://x.com/p" })],
      (id) => id === "closed-dup",
    )
    expect(plan.eligible).toEqual([])
    expect(plan.skipped.sameUrlCovered).toBe(1)
  })
  it("reports worst-case calls as twice the eligible count (root fallback)", () => {
    expect(planBackfill([row("a"), row("b")], () => false).worstCaseCalls).toBe(4)
  })
})

function harness(rows: BackfillRow[], responses: Record<string, CaptureResult>) {
  const files = new Map<string, Uint8Array>()
  const failures = new Map<string, string>()
  const calls: string[] = []
  const store: DrainStore = {
    getTab: async (id) => {
      const r = rows.find((x) => x.id === id)
      return r ? ({ id: r.id, url: r.url, ogImage: r.ogImage, captureFailedAt: failures.has(id) ? "t" : r.captureFailedAt } as DrainTab) : null
    },
    hasScreenshot: (id) => files.has(id),
    writeScreenshot: (id, j) => void files.set(id, j),
    recordFailure: async (id, reason) => void failures.set(id, reason),
  }
  const backend: CaptureBackend = {
    name: "fake",
    captureScreenshot: async (url) => (calls.push(url), responses[url] ?? { ok: false, reason: "no", retryable: false }),
  }
  return { store, backend, files, failures, calls }
}

describe("runBackfill", () => {
  const rows = [
    row("a", { lastAccessedAt: "2026-03-01T00:00:00Z" }),
    row("b", { lastAccessedAt: "2026-02-01T00:00:00Z" }),
    row("c", { lastAccessedAt: "2026-01-01T00:00:00Z" }),
  ]
  const ok = { ok: true, jpeg: JPEG } as const
  const responses = Object.fromEntries(rows.map((r) => [r.url, ok]))

  it("dry run makes no backend calls and writes nothing", async () => {
    const h = harness(rows, responses)
    const out = await runBackfill({ rows, hasFile: h.store.hasScreenshot, apply: false, limit: 2, backend: null, store: h.store, checkUrl: async () => ({ ok: true }) })
    expect(out.plan.eligible).toEqual(["a", "b", "c"])
    expect(out.drain).toBeNull()
    expect(h.calls).toEqual([])
    expect(h.files.size).toBe(0)
  })
  it("apply drains most recent first up to the cap", async () => {
    const h = harness(rows, responses)
    const out = await runBackfill({ rows, hasFile: h.store.hasScreenshot, apply: true, limit: 2, backend: h.backend, store: h.store, checkUrl: async () => ({ ok: true }) })
    expect(h.calls).toEqual([rows[0].url, rows[1].url])
    expect(out.drain?.captured).toBe(2)
    expect(out.drain?.deferred).toEqual(["c"])
  })
  it("is resumable: a second run picks up the remainder", async () => {
    const h = harness(rows, responses)
    const args = { rows, hasFile: (id: string) => h.files.has(id), apply: true, limit: 2, backend: h.backend, store: h.store, checkUrl: async () => ({ ok: true as const }) }
    await runBackfill(args)
    const second = await runBackfill(args)
    expect(second.plan.eligible).toEqual(["c"])
    expect(h.files.size).toBe(3)
  })
  it("apply without a backend throws", async () => {
    const h = harness(rows, responses)
    await expect(
      runBackfill({ rows, hasFile: h.store.hasScreenshot, apply: true, limit: 2, backend: null, store: h.store, checkUrl: async () => ({ ok: true }) }),
    ).rejects.toThrow(/backend/i)
  })
})
