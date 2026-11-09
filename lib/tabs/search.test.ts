import { describe, expect, it } from "bun:test"
import type { Tab } from "@/types"
import type { TabGroup } from "./grouping"
import { filterGroups, filterTabs, stripScheme } from "./search"

function makeTab(id: string, title: string | null, url = `https://example.com/${id}`): Tab {
  return {
    id,
    chromeId: null,
    url,
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

describe("filterTabs", () => {
  it("returns the same array for an empty query", () => {
    expect(filterTabs(tabs, "")).toBe(tabs)
  })

  it("matches case-insensitively anywhere in the title", () => {
    expect(filterTabs(tabs, "AGILE").map((t) => t.id)).toEqual(["a", "d"])
    expect(filterTabs(tabs, "release").map((t) => t.id)).toEqual(["b"])
  })

  it("a tab with no title can't match on title text", () => {
    expect(filterTabs(tabs, "agile").some((t) => t.id === "c")).toBe(false)
  })

  it("returns an empty list when nothing matches", () => {
    expect(filterTabs(tabs, "zzz")).toEqual([])
  })

  it("keeps tab object identity so memoised cards don't re-render", () => {
    expect(filterTabs(tabs, "bun")[0]).toBe(tabs[1])
  })

  it("treats regex and SQL wildcard characters literally", () => {
    const special = [makeTab("x", "100% sure (really)"), makeTab("y", "plain")]
    expect(filterTabs(special, "(really)").map((t) => t.id)).toEqual(["x"])
    expect(filterTabs(special, "%").map((t) => t.id)).toEqual(["x"])
    expect(filterTabs(special, ".*")).toEqual([])
  })
})

describe("filterTabs by URL", () => {
  const hn = makeTab("h", "Hacker News", "https://news.ycombinator.com/item?id=1")
  const other = makeTab("o", "Something else", "http://example.org/path")
  const all = [hn, other]

  it("matches the domain even when the title doesn't contain the text", () => {
    expect(filterTabs(all, "news.").map((t) => t.id)).toEqual(["h"])
    expect(filterTabs(all, "news.ycombinator").map((t) => t.id)).toEqual(["h"])
    expect(filterTabs(all, "YCOMBINATOR.com").map((t) => t.id)).toEqual(["h"])
  })

  it("still matches on title alone", () => {
    expect(filterTabs(all, "hacker").map((t) => t.id)).toEqual(["h"])
  })

  it("matches path and query text in the URL", () => {
    expect(filterTabs(all, "item?id=1").map((t) => t.id)).toEqual(["h"])
    expect(filterTabs(all, "/path").map((t) => t.id)).toEqual(["o"])
  })

  it("does not match every tab on the scheme", () => {
    expect(filterTabs(all, "http")).toEqual([])
    expect(filterTabs(all, "https://")).toEqual([])
  })

  it("matches a tab with no title by URL", () => {
    const untitled = makeTab("u", null, "https://docs.bun.sh/")
    expect(filterTabs([untitled], "docs.bun").map((t) => t.id)).toEqual(["u"])
  })
})

describe("stripScheme", () => {
  it("removes only a leading http(s):// ", () => {
    expect(stripScheme("https://a.com/")).toBe("a.com/")
    expect(stripScheme("HTTP://a.com/")).toBe("a.com/")
    expect(stripScheme("chrome://extensions")).toBe("chrome://extensions")
    expect(stripScheme("https://a.com/?u=https://b.com")).toBe("a.com/?u=https://b.com")
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
