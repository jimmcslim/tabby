import { afterEach, beforeEach, describe, expect, it, setSystemTime } from "bun:test"
import type { ExtensionCommand, SyncResult } from "@/types"
import {
  __resetBridge,
  acquireRestoreLock,
  addSubscriber,
  dispatchCommand,
  drainBacklog,
  getBridge,
  isExtensionFresh,
  isExtensionSseConnected,
  isRestoreLocked,
  recordReport,
  releaseRestoreLock,
  resolveAck,
} from "./bridge"

/** Mirrors RESTORE_LOCK_MAX_MS in bridge.ts (deliberately not exported there). */
const RESTORE_LOCK_MAX_MS = 5 * 60_000

const A_RESULT: SyncResult = { added: 1, updated: 2, closed: 3, total: 6 }

/** Collects everything pushed to a subscriber, and returns the sink. */
function subscribe(): ExtensionCommand[] {
  const received: ExtensionCommand[] = []
  addSubscriber((cmd) => received.push(cmd))
  return received
}

beforeEach(() => {
  __resetBridge()
})

afterEach(() => {
  __resetBridge()
  setSystemTime() // restore the real clock
})

describe("dispatchCommand", () => {
  it("delivers to every subscriber when SSE is connected", async () => {
    const first = subscribe()
    const second = subscribe()

    const pending = dispatchCommand({ type: "focus", tabId: 7 })

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    expect(first[0]).toMatchObject({ type: "focus", tabId: 7 })
    expect(first[0].id).toBeString()
    // Same command object reaches every subscriber
    expect(second[0].id).toBe(first[0].id)
    // Delivered live, so nothing is left for the next snapshot response
    expect(getBridge().backlog).toHaveLength(0)

    resolveAck({ commandId: first[0].id, ok: true })
    await pending
  })

  it("queues to the backlog when nothing is subscribed", async () => {
    const pending = dispatchCommand({ type: "snapshot" })

    const backlog = getBridge().backlog
    expect(backlog).toHaveLength(1)
    expect(backlog[0].type).toBe("snapshot")

    resolveAck({ commandId: backlog[0].id, ok: true })
    await pending
  })

  it("keeps delivering to live subscribers when one throws", async () => {
    addSubscriber(() => {
      throw new Error("dead SSE stream")
    })
    const live = subscribe()

    const pending = dispatchCommand({ type: "close", tabId: 1 })

    expect(live).toHaveLength(1)

    resolveAck({ commandId: live[0].id, ok: true })
    await pending
  })

  it("rejects once the timeout elapses, naming the command type", async () => {
    subscribe()

    await expect(dispatchCommand({ type: "discard", tabId: 2 }, 1)).rejects.toThrow(
      "Extension command timeout: discard",
    )
  })

  it("purges the timed-out command from pending and from the backlog", async () => {
    // No subscriber, so the command lands in the backlog and must be swept
    // from there too — otherwise a dead command ships with the next snapshot.
    await expect(dispatchCommand({ type: "snapshot" }, 1)).rejects.toThrow()

    expect(getBridge().pending.size).toBe(0)
    expect(getBridge().backlog).toHaveLength(0)
  })

  it("gives each command a distinct id", async () => {
    const received = subscribe()

    const a = dispatchCommand({ type: "focus", tabId: 1 })
    const b = dispatchCommand({ type: "focus", tabId: 2 })

    expect(received[0].id).not.toBe(received[1].id)

    resolveAck({ commandId: received[0].id, ok: true })
    resolveAck({ commandId: received[1].id, ok: true })
    await Promise.all([a, b])
  })
})

describe("resolveAck", () => {
  it("resolves the waiting command with the ack payload", async () => {
    const received = subscribe()
    const pending = dispatchCommand({ type: "snapshot" })

    resolveAck({ commandId: received[0].id, ok: true, data: A_RESULT })

    await expect(pending).resolves.toEqual(A_RESULT)
  })

  it("rejects with the reported error", async () => {
    const received = subscribe()
    const pending = dispatchCommand({ type: "open", url: "https://example.com" })

    resolveAck({ commandId: received[0].id, ok: false, error: "no such window" })

    await expect(pending).rejects.toThrow("no such window")
  })

  it("rejects with a fallback message when the failure is unexplained", async () => {
    const received = subscribe()
    const pending = dispatchCommand({ type: "open" })

    resolveAck({ commandId: received[0].id, ok: false })

    await expect(pending).rejects.toThrow("Extension command failed")
  })

  it("ignores an ack for a command it does not know about", () => {
    expect(() => resolveAck({ commandId: "never-dispatched", ok: true })).not.toThrow()
  })

  it("clears the pending entry, so the timeout can no longer fire", async () => {
    const received = subscribe()
    const pending = dispatchCommand({ type: "focus", tabId: 3 }, 50_000)

    expect(getBridge().pending.size).toBe(1)
    resolveAck({ commandId: received[0].id, ok: true, data: "done" })
    expect(getBridge().pending.size).toBe(0)

    await expect(pending).resolves.toBe("done")
  })

  it("ignores a second ack for the same command", async () => {
    const received = subscribe()
    const pending = dispatchCommand({ type: "focus", tabId: 4 })

    resolveAck({ commandId: received[0].id, ok: true, data: "first" })
    resolveAck({ commandId: received[0].id, ok: false, error: "late failure" })

    await expect(pending).resolves.toBe("first")
  })
})

describe("drainBacklog", () => {
  it("hands back the queued commands and empties the queue", async () => {
    const a = dispatchCommand({ type: "focus", tabId: 1 })
    const b = dispatchCommand({ type: "close", tabId: 2 })

    const drained = drainBacklog()
    expect(drained.map((c) => c.type)).toEqual(["focus", "close"])
    expect(drainBacklog()).toEqual([])

    resolveAck({ commandId: drained[0].id, ok: true })
    resolveAck({ commandId: drained[1].id, ok: true })
    await Promise.all([a, b])
  })

  it("is empty when nothing was queued", () => {
    expect(drainBacklog()).toEqual([])
  })
})

describe("restore lock", () => {
  it("is unlocked until acquired", () => {
    expect(isRestoreLocked()).toBe(false)
  })

  it("holds once acquired", () => {
    acquireRestoreLock()
    expect(isRestoreLocked()).toBe(true)
  })

  it("clears on release", () => {
    acquireRestoreLock()
    releaseRestoreLock()
    expect(isRestoreLocked()).toBe(false)
  })

  it("auto-expires, so an abandoned restore cannot wedge the sync pipeline", () => {
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"))
    acquireRestoreLock()

    // Still inside the window
    setSystemTime(new Date(Date.now() + RESTORE_LOCK_MAX_MS - 1))
    expect(isRestoreLocked()).toBe(true)

    // The instant the window closes, the lock stops counting
    setSystemTime(new Date(Date.now() + 1))
    expect(isRestoreLocked()).toBe(false)
  })

  it("pushes the expiry out when re-acquired mid-restore", () => {
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"))
    acquireRestoreLock()

    // The restore loop refreshes the lock each batch
    setSystemTime(new Date(Date.now() + RESTORE_LOCK_MAX_MS - 1000))
    acquireRestoreLock()

    // Past the *original* deadline, but inside the refreshed one
    setSystemTime(new Date(Date.now() + 2000))
    expect(isRestoreLocked()).toBe(true)
  })
})

describe("isExtensionFresh", () => {
  it("is false before the extension has ever reported", () => {
    expect(isExtensionFresh()).toBe(false)
  })

  it("is true immediately after a report", () => {
    recordReport("1.2.3", A_RESULT)
    expect(isExtensionFresh()).toBe(true)
  })

  it("goes stale once maxAgeMs has fully elapsed", () => {
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"))
    recordReport("1.2.3", A_RESULT)

    setSystemTime(new Date(Date.now() + 999))
    expect(isExtensionFresh(1000)).toBe(true)

    setSystemTime(new Date(Date.now() + 1))
    expect(isExtensionFresh(1000)).toBe(false)
  })
})

describe("recordReport", () => {
  it("stores the version and last sync result for later readers", () => {
    recordReport("2.0.0", A_RESULT)

    const bridge = getBridge()
    expect(bridge.extensionVersion).toBe("2.0.0")
    expect(bridge.lastSyncResult).toEqual(A_RESULT)
    expect(bridge.lastReportAt).toBeNumber()
  })
})

describe("subscribers", () => {
  it("reports SSE connectivity from the subscriber count", () => {
    expect(isExtensionSseConnected()).toBe(false)
    const unsubscribe = addSubscriber(() => {})
    expect(isExtensionSseConnected()).toBe(true)
    unsubscribe()
    expect(isExtensionSseConnected()).toBe(false)
  })

  it("routes to the backlog again once the last subscriber leaves", async () => {
    const unsubscribe = addSubscriber(() => {})
    unsubscribe()

    const pending = dispatchCommand({ type: "snapshot" })

    expect(getBridge().backlog).toHaveLength(1)
    resolveAck({ commandId: getBridge().backlog[0].id, ok: true })
    await pending
  })
})
