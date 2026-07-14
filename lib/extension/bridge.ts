import { nanoid } from "nanoid"
import { getDb } from "@/lib/db"
import { settings } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import type { ExtensionCommand, ExtensionCommandAck, SyncResult } from "@/types"

const LAST_REPORT_KEY = "extension_last_report_at"

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
  lastReportLoaded: boolean
  lastSyncResult: SyncResult | null
  extensionVersion?: string
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
      lastReportLoaded: false,
      lastSyncResult: null,
    } satisfies Bridge
  }
  return g[BRIDGE_KEY] as Bridge
}

export function isExtensionSseConnected(): boolean {
  return getBridge().subscribers.size > 0
}

export async function isExtensionFresh(maxAgeMs = 90_000): Promise<boolean> {
  const bridge = getBridge()

  // Hydrate from settings once so a restarted server prefers the extension
  // during its reconnect window instead of falling back to CDP.
  if (bridge.lastReportAt === null && !bridge.lastReportLoaded) {
    bridge.lastReportLoaded = true
    try {
      const db = await getDb()
      const row = db.select().from(settings).where(eq(settings.key, LAST_REPORT_KEY)).get()
      if (row?.value) {
        const ts = Date.parse(row.value)
        if (!Number.isNaN(ts)) bridge.lastReportAt = ts
      }
    } catch {
      // settings unavailable — treat as never reported
    }
  }

  return bridge.lastReportAt !== null && Date.now() - bridge.lastReportAt < maxAgeMs
}

export function recordReport(version: string, result: SyncResult): void {
  const bridge = getBridge()
  bridge.lastReportAt = Date.now()
  bridge.lastReportLoaded = true
  bridge.lastSyncResult = result
  bridge.extensionVersion = version

  // Fire-and-forget persistence
  void (async () => {
    try {
      const db = await getDb()
      const value = new Date(bridge.lastReportAt!).toISOString()
      db.insert(settings)
        .values({ key: LAST_REPORT_KEY, value })
        .onConflictDoUpdate({ target: settings.key, set: { value } })
        .run()
    } catch {
      // non-fatal
    }
  })()
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
