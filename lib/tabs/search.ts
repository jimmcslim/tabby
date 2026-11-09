import type { Tab } from "@/types"
import type { TabGroup } from "./grouping"

/** A URL without its leading `http://` / `https://`, so a query like "http" doesn't match every tab. */
export function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//i, "")
}

/**
 * Tabs whose title or URL contains `query`, case-insensitively and literally
 * (no wildcards). Matching the URL lets "news.ycombinator" find a tab titled
 * "Hacker News"; the scheme is stripped first so "https" doesn't match
 * everything. An empty query keeps everything; a missing title simply can't
 * match. `GET /api/tabs?search=` applies the same rule in SQL, so the Dashboard
 * (filtering the already-loaded tabs in the browser, no round trip per
 * keystroke) and History agree. Returns `tabs` itself (same reference) when
 * nothing is filtered, so memoised consumers don't re-render.
 */
export function filterTabs(tabs: Tab[], query: string): Tab[] {
  if (!query) return tabs
  const needle = query.toLowerCase()
  return tabs.filter(
    (t) =>
      (t.title?.toLowerCase().includes(needle) ?? false) ||
      stripScheme(t.url).toLowerCase().includes(needle),
  )
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
    .map((g) => ({ ...g, tabs: filterTabs(g.tabs, query) }))
    .filter((g) => g.tabs.length > 0)
}
