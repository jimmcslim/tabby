import type { Tab } from "@/types"

export type GroupBy = "window" | "category" | "domain" | "none"
export type SortBy = "browser" | "lastAccessed" | "dateAdded" | "title" | "domain"
export type SortDir = "asc" | "desc"

export interface TabGroup {
  key: string // raw key for identification (e.g. windowId "1382002407")
  label: string // display label
  editable: boolean
  tabs: Tab[]
}

// Ascending form of each criterion; sortTabs negates it for descending.
// tabIndex/lastAccessedAt only exist for extension-sourced tabs, so both
// fall back to first-seen order.
function compareAscending(a: Tab, b: Tab, sortBy: SortBy): number {
  const byFirstSeen = (a: Tab, b: Tab) => a.firstSeenAt.localeCompare(b.firstSeenAt)
  switch (sortBy) {
    case "browser":
      return (
        (a.windowId ?? Number.MAX_SAFE_INTEGER) - (b.windowId ?? Number.MAX_SAFE_INTEGER) ||
        (a.tabIndex ?? Number.MAX_SAFE_INTEGER) - (b.tabIndex ?? Number.MAX_SAFE_INTEGER) ||
        byFirstSeen(a, b)
      )
    case "lastAccessed":
      return (a.lastAccessedAt ?? "").localeCompare(b.lastAccessedAt ?? "") || byFirstSeen(a, b)
    case "dateAdded":
      return byFirstSeen(a, b)
    case "title":
      return (a.title || a.url).localeCompare(b.title || b.url, undefined, { sensitivity: "base" })
    case "domain":
      return (
        (a.domain || "").localeCompare(b.domain || "") ||
        (a.title || a.url).localeCompare(b.title || b.url, undefined, { sensitivity: "base" })
      )
  }
}

// Applied within each group; grouping and sorting are independent, so the
// same sortBy/sortDir apply uniformly across every group.
export function sortTabs(tabs: Tab[], sortBy: SortBy, sortDir: SortDir): Tab[] {
  const sign = sortDir === "desc" ? -1 : 1
  return [...tabs].sort((a, b) => sign * compareAscending(a, b, sortBy))
}

export function groupTabs(
  tabs: Tab[],
  groupBy: GroupBy,
  windowNames: Record<string, string>,
): TabGroup[] {
  if (groupBy === "none") return [{ key: "__all", label: "", editable: false, tabs }]

  const map = new Map<string, Tab[]>()
  const keyOrder: string[] = []
  for (const tab of tabs) {
    let key: string
    switch (groupBy) {
      case "window":
        key = tab.windowId != null ? String(tab.windowId) : "__unknown"
        break
      case "category":
        key = tab.category || "__uncategorized"
        break
      case "domain":
        key = tab.domain || "__unknown"
        break
    }
    const list = map.get(key)
    if (list) {
      list.push(tab)
    } else {
      map.set(key, [tab])
      keyOrder.push(key)
    }
  }

  // For window grouping, assign friendly names
  if (groupBy === "window") {
    let autoIndex = 1
    return keyOrder.map((key) => {
      const tabs = map.get(key)!
      if (key === "__unknown") {
        return { key, label: "Unknown Window", editable: false, tabs }
      }
      const customName = windowNames[key]
      const label = customName || `Window ${autoIndex}`
      autoIndex++
      return { key, label, editable: true, tabs }
    })
  }

  return keyOrder
    .sort((a, b) => {
      if (a.startsWith("__")) return 1
      if (b.startsWith("__")) return -1
      return a.localeCompare(b, undefined, { numeric: true })
    })
    .map((key) => {
      const tabs = map.get(key)!
      const label = key === "__uncategorized" ? "Uncategorized" : key === "__unknown" ? "Unknown" : key
      return { key, label, editable: false, tabs }
    })
}
