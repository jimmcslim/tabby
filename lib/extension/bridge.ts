import { nanoid } from "nanoid"
import type { ExtensionCommand, ExtensionCommandAck, SyncResult } from "@/types"

interface PendingCommand {
  resolve: (data: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface Bridge {
  subscribers: Set<(cmd: ExtensionCommand) => void>
  backlog: ExtensionCommand[]
  pending: Map<string, PendingCommand>
  lastReportAt: number | null
  lastSyncResult: SyncResult | null
  extensionVersion?: string
  /** Epoch ms until which the heavy sync pipeline is suppressed (bulk restore) */
  restoreLockUntil: number | null
  /** Progress of the in-flight restore, if any — for UI display only */
  restoreProgress: { total: number; restored: number } | null
}

// Survives route-handler module duplication in dev, same pattern as getDb
const BRIDGE_KEY = "__tabbyExtensionBridge"

export function getBridge(): Bridge {
  const g = globalThis as Record<string, unknown>
  if (!g[BRIDGE_KEY]) {
    g[BRIDGE_KEY] = {
      subscribers: new Set(),
      backlog: [],
      pending: new Map(),
      lastReportAt: null,
      lastSyncResult: null,
      restoreLockUntil: null,
      restoreProgress: null,
    } satisfies Bridge
  }
  return g[BRIDGE_KEY] as Bridge
}

/**
 * Test-only: drop the cached bridge so each case starts from a clean state.
 * Any in-flight command timers are cleared first, so a discarded bridge can't
 * fire a rejection into a later test.
 */
export function __resetBridge(): void {
  const g = globalThis as Record<string, unknown>
  const existing = g[BRIDGE_KEY] as Bridge | undefined
  if (existing) {
    for (const { timer } of existing.pending.values()) clearTimeout(timer)
  }
  delete g[BRIDGE_KEY]
}

export function isExtensionSseConnected(): boolean {
  return getBridge().subscribers.size > 0
}

// Max window a single restore may hold the lock before it auto-expires, so a
// crashed/abandoned restore can never wedge the sync pipeline permanently. The
// restore loop refreshes it each batch, so this only matters if that loop dies.
const RESTORE_LOCK_MAX_MS = 5 * 60_000

/** Suppress (or refresh suppression of) the heavy sync pipeline during a bulk restore. */
export function acquireRestoreLock(): void {
  getBridge().restoreLockUntil = Date.now() + RESTORE_LOCK_MAX_MS
}

export function releaseRestoreLock(): void {
  getBridge().restoreLockUntil = null
}

export function isRestoreLocked(): boolean {
  const { restoreLockUntil } = getBridge()
  return restoreLockUntil !== null && Date.now() < restoreLockUntil
}

/** Report restore progress for UI display — cleared by the restore route's `finally`. */
export function setRestoreProgress(total: number, restored: number): void {
  getBridge().restoreProgress = { total, restored }
}

export function clearRestoreProgress(): void {
  getBridge().restoreProgress = null
}

/** True when the extension pushed a snapshot recently (covers SSE reconnect gaps) */
export function isExtensionFresh(maxAgeMs = 90_000): boolean {
  const bridge = getBridge()
  return bridge.lastReportAt !== null && Date.now() - bridge.lastReportAt < maxAgeMs
}

export function recordReport(version: string, result: SyncResult): void {
  const bridge = getBridge()
  bridge.lastReportAt = Date.now()
  bridge.lastSyncResult = result
  bridge.extensionVersion = version
}

export function addSubscriber(fn: (cmd: ExtensionCommand) => void): () => void {
  const bridge = getBridge()
  bridge.subscribers.add(fn)
  return () => bridge.subscribers.delete(fn)
}

export function drainBacklog(): ExtensionCommand[] {
  return getBridge().backlog.splice(0)
}

export function dispatchCommand(
  cmd: Omit<ExtensionCommand, "id">,
  timeoutMs = 5000,
): Promise<unknown> {
  const bridge = getBridge()
  const command: ExtensionCommand = { ...cmd, id: nanoid() }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      bridge.pending.delete(command.id)
      const idx = bridge.backlog.findIndex((c) => c.id === command.id)
      if (idx !== -1) bridge.backlog.splice(idx, 1)
      reject(new Error(`Extension command timeout: ${command.type}`))
    }, timeoutMs)

    bridge.pending.set(command.id, { resolve, reject, timer })

    if (bridge.subscribers.size > 0) {
      for (const fn of bridge.subscribers) {
        try {
          fn(command)
        } catch {
          // dead subscriber — cleanup happens on stream abort
        }
      }
    } else {
      // Delivered with the next snapshot response
      bridge.backlog.push(command)
    }
  })
}

export function resolveAck(ack: ExtensionCommandAck): void {
  const bridge = getBridge()
  const pending = bridge.pending.get(ack.commandId)
  if (!pending) return
  bridge.pending.delete(ack.commandId)
  clearTimeout(pending.timer)
  if (ack.ok) pending.resolve(ack.data)
  else pending.reject(new Error(ack.error || "Extension command failed"))
}
