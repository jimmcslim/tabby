import { describe, expect, it } from "bun:test"
import { createCaptureQueue } from "./queue"

const empty = { captured: 0, failed: 0, retryable: 0, deferred: [] as string[] }

describe("createCaptureQueue", () => {
  it("batches enqueued ids into one drain, deduplicating repeats", async () => {
    const batches: string[][] = []
    const q = createCaptureQueue({ run: async (ids) => (batches.push(ids), empty), delayMs: 0 })
    q.enqueue("a")
    q.enqueue("b")
    q.enqueue("a")
    await q.idle()
    expect(batches).toEqual([["a", "b"]])
  })

  it("does not run concurrent drains; ids arriving mid-drain go in a following drain", async () => {
    const batches: string[][] = []
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const q = createCaptureQueue({
      run: async (ids) => {
        batches.push(ids)
        if (batches.length === 1) await gate
        return empty
      },
      delayMs: 0,
    })
    q.enqueue("a")
    await new Promise((r) => setTimeout(r, 5)) // first drain is now in flight
    q.enqueue("b")
    q.enqueue("a") // already in flight: not requeued
    release()
    await q.idle()
    expect(batches).toEqual([["a"], ["b"]])
  })

  it("survives a failing drain and keeps accepting ids", async () => {
    let n = 0
    const batches: string[][] = []
    const q = createCaptureQueue({
      run: async (ids) => {
        batches.push(ids)
        if (n++ === 0) throw new Error("boom")
        return empty
      },
      delayMs: 0,
    })
    q.enqueue("a")
    await q.idle()
    q.enqueue("b")
    await q.idle()
    expect(batches).toEqual([["a"], ["b"]])
  })
})
