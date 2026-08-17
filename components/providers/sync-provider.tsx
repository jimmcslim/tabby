"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import type { SyncResult, ChromeStatus } from "@/types"

interface SyncState {
  lastSync: Date | null
  lastResult: SyncResult | null
  isSyncing: boolean
  chromeStatus: ChromeStatus | null
  triggerSync: () => Promise<void>
  syncIntervalMs: number
  setSyncInterval: (seconds: number) => Promise<void>
}

const DEFAULT_SYNC_INTERVAL_MS = 30_000
// While a restore is in progress (anywhere — not just this tab), poll fast so
// the "Restoring..." indicator and tab list catch up promptly instead of
// waiting out the normal interval.
const RESTORE_POLL_MS = 2_000

const SyncContext = createContext<SyncState>({
  lastSync: null,
  lastResult: null,
  isSyncing: false,
  chromeStatus: null,
  triggerSync: async () => {},
  syncIntervalMs: DEFAULT_SYNC_INTERVAL_MS,
  setSyncInterval: async () => {},
})

export function useSyncContext() {
  return useContext(SyncContext)
}

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [lastSync, setLastSync] = useState<Date | null>(null)
  const [lastResult, setLastResult] = useState<SyncResult | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [chromeStatus, setChromeStatus] = useState<ChromeStatus | null>(null)
  const [syncIntervalMs, setSyncIntervalMs] = useState(DEFAULT_SYNC_INTERVAL_MS)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const checkChromeStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/chrome/status")
      const data: ChromeStatus = await res.json()
      setChromeStatus(data)
      return data.connected
    } catch {
      setChromeStatus({ connected: false, source: "none" })
      return false
    }
  }, [])

  const triggerSync = useCallback(async () => {
    setIsSyncing(true)
    try {
      const res = await fetch("/api/tabs/sync", { method: "POST" })
      if (res.ok) {
        const result: SyncResult = await res.json()
        setLastResult(result)
        setLastSync(new Date())
      }
    } catch {
      // Sync failed silently
    } finally {
      setIsSyncing(false)
    }
  }, [])

  const setSyncInterval = useCallback(async (seconds: number) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ syncIntervalSeconds: seconds }),
      })
      if (res.ok) {
        const data: { syncIntervalSeconds: number } = await res.json()
        setSyncIntervalMs(data.syncIntervalSeconds * 1000)
      }
    } catch {
      // Persist failed silently — keep the current interval
    }
  }, [])

  // Load the persisted interval and do the initial check + sync once on mount.
  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data: { syncIntervalSeconds: number }) => {
        if (Number.isFinite(data?.syncIntervalSeconds)) {
          setSyncIntervalMs(data.syncIntervalSeconds * 1000)
        }
      })
      .catch(() => {
        // Fall back to the default interval already in state
      })

    checkChromeStatus().then((connected) => {
      if (connected) triggerSync()
    })
  }, [checkChromeStatus, triggerSync])

  // (Re)schedule the periodic sync whenever the interval changes, or a
  // restore starts/finishes (switches between fast and normal polling).
  useEffect(() => {
    const ms = chromeStatus?.restoring ? RESTORE_POLL_MS : syncIntervalMs
    intervalRef.current = setInterval(async () => {
      const connected = await checkChromeStatus()
      if (connected) triggerSync()
    }, ms)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [checkChromeStatus, triggerSync, syncIntervalMs, chromeStatus?.restoring])

  return (
    <SyncContext.Provider
      value={{
        lastSync,
        lastResult,
        isSyncing,
        chromeStatus,
        triggerSync,
        syncIntervalMs,
        setSyncInterval,
      }}
    >
      {children}
    </SyncContext.Provider>
  )
}
