import type { Tab } from "@/types"
import { MAX_PAGE_SIZE } from "./paging"

/** One page of `GET /api/tabs`: the response is always paged. */
export interface TabsPage {
  tabs: Tab[]
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null
}

export interface TabsQuery {
  status: string
  search?: string
  limit?: number
  cursor?: string | null
}

/** One page of tabs, or null if the request failed. */
export async function fetchTabsPage(query: TabsQuery): Promise<TabsPage | null> {
  const params = new URLSearchParams({ status: query.status })
  if (query.search) params.set("search", query.search)
  if (query.limit) params.set("limit", String(query.limit))
  if (query.cursor) params.set("cursor", query.cursor)
  try {
    const res = await fetch(`/api/tabs?${params}`)
    return res.ok ? ((await res.json()) as TabsPage) : null
  } catch {
    return null
  }
}

/**
 * Every tab with `status`, following cursors until the last page. For lists
 * that are bounded and need the whole set (the Dashboard's open tabs) — never
 * use it for `closed`, which is unbounded. Null if any page fails, so callers
 * never act on a silently truncated list.
 */
export async function fetchAllTabs(status: string): Promise<Tab[] | null> {
  const all: Tab[] = []
  let cursor: string | null = null
  do {
    const page: TabsPage | null = await fetchTabsPage({ status, limit: MAX_PAGE_SIZE, cursor })
    if (!page) return null
    all.push(...page.tabs)
    cursor = page.nextCursor
  } while (cursor)
  return all
}
