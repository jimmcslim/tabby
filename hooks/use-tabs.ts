"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { useSyncContext } from "@/components/providers/sync-provider"
import type { ClassifyResponse, Tab } from "@/types"

export interface UseTabs {
  tabs: Tab[]
  loading: boolean
  /** Per-window display names, keyed by window id. */
  windowNames: Record<string, string>
  /** Refetch the open tabs for the current search. */
  refresh: () => Promise<void>
  renameWindow: (windowId: string, name: string) => Promise<void>
  focusTab: (tabId: string) => Promise<void>
  /** Close in Chrome and drop from local state. */
  closeTabs: (tabIds: string[]) => Promise<void>
  /** Drop from local state only — for callers that did the closing themselves. */
  forgetTabs: (tabIds: string[]) => void
  openTabInWindow: (windowId: number) => Promise<void>
  replaceTab: (tab: Tab) => void
  applyClassifications: (results: ClassifyResponse["results"]) => void
}

/**
 * The dashboard's data layer: the open tabs for the current search, their
 * window names, and every mutation that changes them. Refetches whenever the
 * search changes or a sync lands.
 */
export function useTabs(search: string): UseTabs {
  const { lastSync } = useSyncContext()
  const [tabs, setTabs] = useState<Tab[]>([])
  const [windowNames, setWindowNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const params = new URLSearchParams({ status: "open" })
      if (search) params.set("search", search)
      const res = await fetch(`/api/tabs?${params}`)
      if (res.ok) setTabs(await res.json())
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    refresh()
  }, [refresh, lastSync])

  useEffect(() => {
    fetch("/api/window-names")
      .then((r) => r.json())
      .then(setWindowNames)
      .catch(() => {})
  }, [])

  const renameWindow = useCallback(async (windowId: string, name: string) => {
    setWindowNames((prev) => ({ ...prev, [windowId]: name }))
    await fetch("/api/window-names", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ windowId, name }),
    })
  }, [])

  const focusTab = useCallback(async (tabId: string) => {
    await fetch("/api/chrome/focus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tabId }),
    })
  }, [])

  const forgetTabs = useCallback((tabIds: string[]) => {
    const dropped = new Set(tabIds)
    setTabs((prev) => prev.filter((t) => !dropped.has(t.id)))
  }, [])

  const closeTabs = useCallback(
    async (tabIds: string[]) => {
      await Promise.all(
        tabIds.map((tabId) =>
          fetch("/api/chrome/close", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tabId }),
          }),
        ),
      )
      forgetTabs(tabIds)
    },
    [forgetTabs],
  )

  const openTabInWindow = useCallback(
    async (windowId: number) => {
      const res = await fetch("/api/chrome/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ windowId }),
      })
      if (res.ok) {
        refresh()
      } else {
        toast.error("Failed to open tab")
      }
    },
    [refresh],
  )

  const replaceTab = useCallback((updated: Tab) => {
    setTabs((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
  }, [])

  const applyClassifications = useCallback((results: ClassifyResponse["results"]) => {
    const updates = new Map(results.map((r) => [r.id, { category: r.category, isArticle: r.isArticle }]))
    setTabs((prev) =>
      prev.map((t) => {
        const u = updates.get(t.id)
        return u ? { ...t, category: u.category, isArticle: u.isArticle } : t
      }),
    )
  }, [])

  return {
    tabs,
    loading,
    windowNames,
    refresh,
    renameWindow,
    focusTab,
    closeTabs,
    forgetTabs,
    openTabInWindow,
    replaceTab,
    applyClassifications,
  }
}
