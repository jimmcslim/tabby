import type { Tab } from "@/types"
import type { TabGroup } from "./grouping"

/**
 * Tabs whose title contains `query`, case-insensitively. An empty query keeps
 * everything; a tab with no title never matches a non-empty query. Mirrors the
 * title `LIKE %query%` filter `GET /api/tabs?search=` applies, so filtering the
 * already-loaded tabs in the browser shows the same results without a round
 * trip per keystroke. Returns `tabs` itself (same reference) when nothing is
 * filtered, so memoised consumers don't re-render.
 */
export function filterTabsByTitle(tabs: Tab[], query: string): Tab[] {
  if (!query) return tabs
  const needle = query.toLowerCase()
  return tabs.filter((t) => t.title?.toLowerCase().includes(needle) ?? false)
}

/**
 * Narrow already-built groups to the tabs matching `query`, dropping groups
 * left empty. Group keys, labels and order are untouched (so "Window 2" stays
 * "Window 2" while searching) and `totalCount` still holds the unfiltered size.
 * An empty query returns `groups` itself.
 */
export function filterGroups(groups: TabGroup[], query: string): TabGroup[] {
  if (!query) return groups
  return groups
    .map((g) => ({ ...g, tabs: filterTabsByTitle(g.tabs, query) }))
    .filter((g) => g.tabs.length > 0)
}
