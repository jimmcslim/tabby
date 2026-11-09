import { describe, expect, it } from "bun:test"
import { runDrain, type DrainStore, type DrainTab } from "./drain"
import type { CaptureBackend, CaptureResult } from "./types"

const JPEG = new Uint8Array([0xff, 0xd8, 0xff])

function fakeStore(tabs: DrainTab[], existing: string[] = []) {
  const rows = new Map(tabs.map((t) => [t.id, { ...t }]))
  const files = new Map<string, Uint8Array>(existing.map((id) => [id, JPEG]))
  const failures = new Map<string, string>()
  const store: DrainStore = {
    getTab: async (id) => rows.get(id) ?? null,
    hasScreenshot: (id) => files.has(id),
    writeScreenshot: (id, jpeg) => void files.set(id, jpeg),
    recordFailure: async (id, reason) => void failures.set(id, reason),
  }
  return { store, files, failures }
}

function fakeBackend(responses: Record<string, CaptureResult>) {
  const calls: string[] = []
  const backend: CaptureBackend = {
    name: "fake",
    captureScreenshot: async (url) => {
      calls.push(url)
      return responses[url] ?? { ok: false, reason: "unexpected", retryable: false }
    },
  }
  return { backend, calls }
}

const allow = async () => ({ ok: true as const })
const tab = (id: string, url: string, extra: Partial<DrainTab> = {}): DrainTab => ({
  id,
  url,
  ogImage: null,
  captureFailedAt: null,
  ...extra,
})

describe("runDrain", () => {
  it("captures a tab with no screenshot and no OG image and stores the jpeg", async () => {
    const { store, files } = fakeStore([tab("a", "https://x.com/p")])
    const { backend, calls } = fakeBackend({ "https://x.com/p": { ok: true, jpeg: JPEG } })
    const r = await runDrain({ backend, store, ids: ["a"], limit: 5, checkUrl: allow })
    expect(calls).toEqual(["https://x.com/p"])
    expect(files.get("a")).toEqual(JPEG)
    expect(r.captured).toBe(1)
  })

  it("never requests tabs that already have a screenshot, an OG image, a recorded failure, or no row", async () => {
    const { store } = fakeStore(
      [
        tab("shot", "https://x.com/1"),
        tab("og", "https://x.com/2", { ogImage: "https://x.com/og.png" }),
        tab("failed", "https://x.com/3", { captureFailedAt: "2026-01-01T00:00:00Z" }),
      ],
      ["shot"],
    )
    const { backend, calls } = fakeBackend({})
    await runDrain({ backend, store, ids: ["shot", "og", "failed", "ghost"], limit: 5, checkUrl: allow })
    expect(calls).toEqual([])
  })

  it("treats an empty-string OG image (checked, none) as no OG image", async () => {
    const { store } = fakeStore([tab("a", "https://x.com/p", { ogImage: "" })])
    const { backend, calls } = fakeBackend({ "https://x.com/p": { ok: true, jpeg: JPEG } })
    await runDrain({ backend, store, ids: ["a"], limit: 5, checkUrl: allow })
    expect(calls).toHaveLength(1)
  })

  it("stops at the per-drain cap", async () => {
    const tabs = ["a", "b", "c"].map((id) => tab(id, `https://x.com/${id}`))
    const { store, files } = fakeStore(tabs)
    const { backend, calls } = fakeBackend({
      "https://x.com/a": { ok: true, jpeg: JPEG },
      "https://x.com/b": { ok: true, jpeg: JPEG },
      "https://x.com/c": { ok: true, jpeg: JPEG },
    })
    const r = await runDrain({ backend, store, ids: ["a", "b", "c"], limit: 2, checkUrl: allow })
    expect(calls).toHaveLength(2)
    expect([...files.keys()]).toEqual(["a", "b"])
    expect(r.deferred).toEqual(["c"])
  })

  it("does not call the backend for urls rejected by the guard and memoises the rejection", async () => {
    const { store, failures } = fakeStore([tab("a", "http://192.168.0.1/")])
    const { backend, calls } = fakeBackend({})
    await runDrain({
      backend,
      store,
      ids: ["a"],
      limit: 5,
      checkUrl: async () => ({ ok: false, reason: "private-address" }),
    })
    expect(calls).toEqual([])
    expect(failures.get("a")).toBe("private-address")
  })

  it("memoises a permanent failure so the tab is not retried", async () => {
    const { store, failures } = fakeStore([tab("a", "https://x.com/")])
    const { backend } = fakeBackend({
      "https://x.com/": { ok: false, reason: "http-500", httpStatus: 500, retryable: false },
    })
    await runDrain({ backend, store, ids: ["a"], limit: 5, checkUrl: allow })
    expect(failures.get("a")).toBe("http-500")
  })

  it("does not memoise a retryable failure", async () => {
    const { store, failures } = fakeStore([tab("a", "https://x.com/p")])
    const { backend } = fakeBackend({
      "https://x.com/p": { ok: false, reason: "rate-limited", retryable: true },
    })
    const r = await runDrain({ backend, store, ids: ["a"], limit: 5, checkUrl: allow })
    expect(failures.size).toBe(0)
    expect(r.retryable).toBe(1)
  })

  describe("4xx domain-root fallback", () => {
    const notFound: CaptureResult = { ok: false, reason: "http-404", httpStatus: 404, retryable: false }

    it("retries once with the domain root and stores that image as the tab's capture", async () => {
      const { store, files, failures } = fakeStore([tab("a", "https://x.com/gone/page")])
      const { backend, calls } = fakeBackend({
        "https://x.com/gone/page": notFound,
        "https://x.com/": { ok: true, jpeg: JPEG },
      })
      await runDrain({ backend, store, ids: ["a"], limit: 5, checkUrl: allow })
      expect(calls).toEqual(["https://x.com/gone/page", "https://x.com/"])
      expect(files.get("a")).toEqual(JPEG)
      expect(failures.size).toBe(0)
    })

    it("memoises the original failure only when the root attempt also fails", async () => {
      const { store, failures } = fakeStore([tab("a", "https://x.com/gone")])
      const { backend, calls } = fakeBackend({
        "https://x.com/gone": notFound,
        "https://x.com/": { ok: false, reason: "http-403", httpStatus: 403, retryable: false },
      })
      await runDrain({ backend, store, ids: ["a"], limit: 5, checkUrl: allow })
      expect(calls).toHaveLength(2) // exactly one root retry, no loop
      expect(failures.get("a")).toBe("http-404")
    })

    it("skips the retry when the url already is the root", async () => {
      const { store, failures } = fakeStore([tab("a", "https://x.com/")])
      const { backend, calls } = fakeBackend({ "https://x.com/": notFound })
      await runDrain({ backend, store, ids: ["a"], limit: 5, checkUrl: allow })
      expect(calls).toEqual(["https://x.com/"])
      expect(failures.get("a")).toBe("http-404")
    })

    it("counts the root attempt against the cap", async () => {
      const { store, failures } = fakeStore([tab("a", "https://x.com/gone"), tab("b", "https://y.com/p")])
      const { backend, calls } = fakeBackend({
        "https://x.com/gone": notFound,
        "https://x.com/": { ok: true, jpeg: JPEG },
        "https://y.com/p": { ok: true, jpeg: JPEG },
      })
      const r = await runDrain({ backend, store, ids: ["a", "b"], limit: 2, checkUrl: allow })
      expect(calls).toEqual(["https://x.com/gone", "https://x.com/"])
      expect(r.deferred).toEqual(["b"])
      expect(failures.size).toBe(0)
    })

    it("applies the guards to the root url too", async () => {
      const { store, failures } = fakeStore([tab("a", "https://x.com/gone")])
      const { backend, calls } = fakeBackend({ "https://x.com/gone": notFound })
      await runDrain({
        backend,
        store,
        ids: ["a"],
        limit: 5,
        checkUrl: async (u) => (u === "https://x.com/" ? { ok: false, reason: "denylisted" } : { ok: true }),
      })
      expect(calls).toEqual(["https://x.com/gone"])
      expect(failures.get("a")).toBe("http-404")
    })

    it("does not fall back on 5xx", async () => {
      const { store } = fakeStore([tab("a", "https://x.com/p")])
      const { backend, calls } = fakeBackend({
        "https://x.com/p": { ok: false, reason: "http-503", httpStatus: 503, retryable: false },
      })
      await runDrain({ backend, store, ids: ["a"], limit: 5, checkUrl: allow })
      expect(calls).toHaveLength(1)
    })
  })
})
