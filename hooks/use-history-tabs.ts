"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { Tab } from "@/types"

const PAGE_SIZE = 100
const SEARCH_DEBOUNCE_MS = 200

interface Page {
  tabs: Tab[]
  nextCursor: string | null
}

export interface UseHistoryTabs {
  tabs: Tab[]
  /** First page for the current search is loading. */
  loading: boolean
  /** A further page is loading. */
  loadingMore: boolean
  hasMore: boolean
  loadMore: () => void
  /** Drop a tab from the list (e.g. after reopening it). */
  remove: (tabId: string) => void
  replace: (tab: Tab) => void
}

/**
 * The History page's data layer: closed tabs, newest first, loaded a page at a
 * time (`GET /api/tabs?status=closed&limit=…&cursor=…`) so ~25k rows never hit
 * the browser at once. Changing `search` restarts from the first page; every
 * request carries the generation it was made in, so a slow response for an
 * older search or a previous page-load can never overwrite newer results.
 */
export function useHistoryTabs(search: string): UseHistoryTabs {
  // `search` records which query `tabs`/`cursor` belong to; while it differs from
  // the current search, the first page for the new query is still loading.
  const [state, setState] = useState<{ search: string | null; tabs: Tab[]; cursor: string | null }>({
    search: null,
    tabs: [],
    cursor: null,
  })
  const [loadingMore, setLoadingMore] = useState(false)

  // Bumped whenever the query restarts; responses from an older generation are dropped.
  const generation = useRef(0)
  const loadingMoreRef = useRef(false)
  const cursorRef = useRef<string | null>(null)

  const fetchPage = useCallback(
    async (query: string, cursor: string | null): Promise<Page | null> => {
      const params = new URLSearchParams({ status: "closed", limit: String(PAGE_SIZE) })
      if (query) params.set("search", query)
      if (cursor) params.set("cursor", cursor)
      try {
        const res = await fetch(`/api/tabs?${params}`)
        return res.ok ? ((await res.json()) as Page) : null
      } catch {
        return null
      }
    },
    [],
  )

  // (Re)start from the first page whenever the search changes. Typing is
  // debounced; clearing the box is immediate.
  useEffect(() => {
    const mine = ++generation.current
    cursorRef.current = null
    const timer = setTimeout(
      async () => {
        const page = await fetchPage(search, null)
        if (generation.current !== mine) return
        cursorRef.current = page?.nextCursor ?? null
        loadingMoreRef.current = false
        setLoadingMore(false)
        setState({ search, tabs: page?.tabs ?? [], cursor: cursorRef.current })
      },
      search ? SEARCH_DEBOUNCE_MS : 0,
    )
    return () => clearTimeout(timer)
  }, [search, fetchPage])

  const loadMore = useCallback(async () => {
    const cursor = cursorRef.current
    if (!cursor || loadingMoreRef.current) return
    const mine = generation.current
    loadingMoreRef.current = true
    setLoadingMore(true)
    const page = await fetchPage(search, cursor)
    // The query restarted meanwhile; the restart's first page resets loadingMore.
    if (generation.current !== mine) return
    loadingMoreRef.current = false
    setLoadingMore(false)
    if (!page) return // keep the cursor so a later scroll retries
    cursorRef.current = page.nextCursor
    setState((prev) => {
      const seen = new Set(prev.tabs.map((t) => t.id))
      return {
        search: prev.search,
        tabs: [...prev.tabs, ...page.tabs.filter((t) => !seen.has(t.id))],
        cursor: page.nextCursor,
      }
    })
  }, [search, fetchPage])

  const remove = useCallback((tabId: string) => {
    setState((prev) => ({ ...prev, tabs: prev.tabs.filter((t) => t.id !== tabId) }))
  }, [])

  const replace = useCallback((tab: Tab) => {
    setState((prev) => ({ ...prev, tabs: prev.tabs.map((t) => (t.id === tab.id ? tab : t)) }))
  }, [])

  const loading = state.search !== search
  return {
    tabs: loading ? [] : state.tabs,
    loading,
    loadingMore,
    hasMore: !loading && state.cursor !== null,
    loadMore,
    remove,
    replace,
  }
}
