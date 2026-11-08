import { describe, expect, it } from "bun:test"
import type { Tab } from "@/types"
import type { TabGroup } from "./grouping"
import { filterGroups, filterTabsByTitle } from "./search"

function makeTab(id: string, title: string | null): Tab {
  return {
    id,
    chromeId: null,
    url: `https://example.com/${id}`,
    title,
    domain: null,
    faviconUrl: null,
    status: "open",
    type: "page",
    category: null,
    summary: null,
    ogImage: null,
    description: null,
    windowId: null,
    tabIndex: null,
    lastAccessedAt: null,
    suspendedState: null,
    isArticle: null,
    isPinned: false,
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:00:00.000Z",
  } as Tab
}

const tabs = [
  makeTab("a", "Agile Wall — Boards"),
  makeTab("b", "Bun 1.4 release notes"),
  makeTab("c", null),
  makeTab("d", "agile retrospective"),
]

describe("filterTabsByTitle", () => {
  it("returns the same array for an empty query", () => {
    expect(filterTabsByTitle(tabs, "")).toBe(tabs)
  })

  it("matches case-insensitively anywhere in the title", () => {
    expect(filterTabsByTitle(tabs, "AGILE").map((t) => t.id)).toEqual(["a", "d"])
    expect(filterTabsByTitle(tabs, "release").map((t) => t.id)).toEqual(["b"])
  })

  it("never matches a tab with no title", () => {
    expect(filterTabsByTitle(tabs, "e").some((t) => t.id === "c")).toBe(false)
  })

  it("returns an empty list when nothing matches", () => {
    expect(filterTabsByTitle(tabs, "zzz")).toEqual([])
  })

  it("keeps tab object identity so memoised cards don't re-render", () => {
    expect(filterTabsByTitle(tabs, "bun")[0]).toBe(tabs[1])
  })

  it("treats regex and SQL wildcard characters literally", () => {
    const special = [makeTab("x", "100% sure (really)"), makeTab("y", "plain")]
    expect(filterTabsByTitle(special, "(really)").map((t) => t.id)).toEqual(["x"])
    expect(filterTabsByTitle(special, "%").map((t) => t.id)).toEqual(["x"])
    expect(filterTabsByTitle(special, ".*")).toEqual([])
  })
})

describe("filterGroups", () => {
  const group = (key: string, label: string, groupTabs: Tab[]): TabGroup => ({
    key,
    label,
    editable: true,
    tabs: groupTabs,
    totalCount: groupTabs.length,
  })
  const groups = [
    group("1", "Window 1", [tabs[0], tabs[1]]),
    group("2", "Window 2", [tabs[2], tabs[3]]),
    group("3", "Window 3", [makeTab("e", "Zebra")]),
  ]

  it("returns the same groups for an empty query", () => {
    expect(filterGroups(groups, "")).toBe(groups)
  })

  it("filters tabs within each group and keeps the unfiltered totalCount", () => {
    const result = filterGroups(groups, "agile")
    expect(result.map((g) => [g.key, g.tabs.map((t) => t.id), g.totalCount])).toEqual([
      ["1", ["a"], 2],
      ["2", ["d"], 2],
    ])
  })

  it("drops groups with no matches without renumbering the rest", () => {
    const result = filterGroups(groups, "zebra")
    expect(result.map((g) => g.label)).toEqual(["Window 3"])
  })

  it("returns no groups when nothing matches", () => {
    expect(filterGroups(groups, "zzz")).toEqual([])
  })
})
