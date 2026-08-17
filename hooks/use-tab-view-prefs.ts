"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import {
  type GroupBy,
  type SortBy,
  type SortDir,
  type TabGroup,
  groupTabs,
  sortTabs,
} from "@/lib/tabs/grouping"
import type { Tab } from "@/types"

export interface UseTabViewPrefs {
  search: string
  setSearch: (search: string) => void
  groupBy: GroupBy
  setGroupBy: (groupBy: GroupBy) => void
  sortBy: SortBy
  setSortBy: (sortBy: SortBy) => void
  sortDir: SortDir
  toggleSortDir: () => void
  view: "card" | "list"
  setView: (view: "card" | "list") => void
  /** Cards per row in card view: 4 (max zoom in, default) to 16 (max zoom out) */
  gridCols: number
  setGridCols: (cols: number) => void
  isCollapsed: (key: string) => boolean
  toggleCollapsed: (key: string) => void
  /** Ref callback that registers a group's element for scrollGroupIntoView. */
  registerGroup: (key: string) => (el: HTMLDivElement | null) => void
  scrollGroupIntoView: (key: string, edge: "start" | "end") => void
}

/** How the dashboard is searched, grouped, sorted and laid out. */
export function useTabViewPrefs(): UseTabViewPrefs {
  const [search, setSearch] = useState("")
  const [groupBy, setGroupBy] = useState<GroupBy>("window")
  const [sortBy, setSortBy] = useState<SortBy>("browser")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [view, setView] = useState<"card" | "list">("card")
  const [gridCols, setGridCols] = useState(4)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const groupRefs = useRef(new Map<string, HTMLDivElement>())

  // Group keys aren't stable across grouping modes (e.g. a window id could
  // collide with a domain string), so collapsed state doesn't carry over.
  const [lastGroupBy, setLastGroupBy] = useState(groupBy)
  if (lastGroupBy !== groupBy) {
    setLastGroupBy(groupBy)
    setCollapsedGroups(new Set())
  }

  const toggleSortDir = useCallback(() => setSortDir((d) => (d === "asc" ? "desc" : "asc")), [])

  const isCollapsed = useCallback((key: string) => collapsedGroups.has(key), [collapsedGroups])

  const toggleCollapsed = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const registerGroup = useCallback(
    (key: string) => (el: HTMLDivElement | null) => {
      if (el) groupRefs.current.set(key, el)
      else groupRefs.current.delete(key)
    },
    [],
  )

  const scrollGroupIntoView = useCallback((key: string, edge: "start" | "end") => {
    groupRefs.current.get(key)?.scrollIntoView({ behavior: "smooth", block: edge })
  }, [])

  return {
    search,
    setSearch,
    groupBy,
    setGroupBy,
    sortBy,
    setSortBy,
    sortDir,
    toggleSortDir,
    view,
    setView,
    gridCols,
    setGridCols,
    isCollapsed,
    toggleCollapsed,
    registerGroup,
    scrollGroupIntoView,
  }
}

/** The tabs grouped and sorted for display, per the current preferences. */
export function useTabGroups(
  tabs: Tab[],
  windowNames: Record<string, string>,
  prefs: Pick<UseTabViewPrefs, "groupBy" | "sortBy" | "sortDir">,
): TabGroup[] {
  const { groupBy, sortBy, sortDir } = prefs
  return useMemo(
    () =>
      groupTabs(tabs, groupBy, windowNames).map((g) => ({
        ...g,
        tabs: sortTabs(g.tabs, sortBy, sortDir),
      })),
    [tabs, groupBy, windowNames, sortBy, sortDir],
  )
}
