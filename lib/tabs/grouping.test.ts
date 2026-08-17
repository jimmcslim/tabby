import { describe, expect, it } from "bun:test"
import type { Tab } from "@/types"
import { groupTabs, sortTabs } from "./grouping"

/** A tab with every required field filled in, so cases only state what matters. */
function makeTab(overrides: Partial<Tab> & { id: string }): Tab {
  return {
    chromeId: null,
    url: `https://example.com/${overrides.id}`,
    title: null,
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
    closedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

const ids = (tabs: Tab[]) => tabs.map((t) => t.id)

describe("sortTabs", () => {
  describe("browser order", () => {
    const tabs = [
      makeTab({ id: "w2-first", windowId: 2, tabIndex: 0 }),
      makeTab({ id: "w1-second", windowId: 1, tabIndex: 1 }),
      makeTab({ id: "w1-first", windowId: 1, tabIndex: 0 }),
    ]

    it("orders by window, then position in the window", () => {
      expect(ids(sortTabs(tabs, "browser", "asc"))).toEqual(["w1-first", "w1-second", "w2-first"])
    })

    it("reverses for descending", () => {
      expect(ids(sortTabs(tabs, "browser", "desc"))).toEqual(["w2-first", "w1-second", "w1-first"])
    })

    it("puts tabs with no window or position last, ordered by first seen", () => {
      const mixed = [
        makeTab({ id: "no-window-later", firstSeenAt: "2026-01-02T00:00:00.000Z" }),
        makeTab({ id: "no-window-earlier", firstSeenAt: "2026-01-01T00:00:00.000Z" }),
        makeTab({ id: "windowed", windowId: 5, tabIndex: 0 }),
      ]
      expect(ids(sortTabs(mixed, "browser", "asc"))).toEqual([
        "windowed",
        "no-window-earlier",
        "no-window-later",
      ])
    })

    it("falls back to first seen when window and position tie", () => {
      const tied = [
        makeTab({ id: "later", windowId: 1, tabIndex: 0, firstSeenAt: "2026-02-01T00:00:00.000Z" }),
        makeTab({ id: "earlier", windowId: 1, tabIndex: 0, firstSeenAt: "2026-01-01T00:00:00.000Z" }),
      ]
      expect(ids(sortTabs(tied, "browser", "asc"))).toEqual(["earlier", "later"])
    })
  })

  describe("last accessed", () => {
    const tabs = [
      makeTab({ id: "recent", lastAccessedAt: "2026-03-01T00:00:00.000Z" }),
      makeTab({ id: "never", firstSeenAt: "2026-01-01T00:00:00.000Z" }),
      makeTab({ id: "older", lastAccessedAt: "2026-02-01T00:00:00.000Z" }),
    ]

    it("orders oldest first, with never-accessed tabs ahead of them", () => {
      expect(ids(sortTabs(tabs, "lastAccessed", "asc"))).toEqual(["never", "older", "recent"])
    })

    it("puts the most recently accessed first when descending", () => {
      expect(ids(sortTabs(tabs, "lastAccessed", "desc"))).toEqual(["recent", "older", "never"])
    })

    it("falls back to first seen when both are unaccessed", () => {
      const unaccessed = [
        makeTab({ id: "later", firstSeenAt: "2026-02-01T00:00:00.000Z" }),
        makeTab({ id: "earlier", firstSeenAt: "2026-01-01T00:00:00.000Z" }),
      ]
      expect(ids(sortTabs(unaccessed, "lastAccessed", "asc"))).toEqual(["earlier", "later"])
    })
  })

  describe("date added", () => {
    const tabs = [
      makeTab({ id: "newest", firstSeenAt: "2026-03-01T00:00:00.000Z" }),
      makeTab({ id: "oldest", firstSeenAt: "2026-01-01T00:00:00.000Z" }),
      makeTab({ id: "middle", firstSeenAt: "2026-02-01T00:00:00.000Z" }),
    ]

    it("orders by when the tab was first seen", () => {
      expect(ids(sortTabs(tabs, "dateAdded", "asc"))).toEqual(["oldest", "middle", "newest"])
      expect(ids(sortTabs(tabs, "dateAdded", "desc"))).toEqual(["newest", "middle", "oldest"])
    })
  })

  describe("title", () => {
    it("compares case-insensitively", () => {
      const tabs = [
        makeTab({ id: "b", title: "banana" }),
        makeTab({ id: "A", title: "Apple" }),
        makeTab({ id: "c", title: "Cherry" }),
      ]
      expect(ids(sortTabs(tabs, "title", "asc"))).toEqual(["A", "b", "c"])
    })

    it("falls back to the url when a tab has no title", () => {
      const tabs = [
        makeTab({ id: "titled", title: "Zebra" }),
        makeTab({ id: "untitled", url: "https://apple.com/" }),
      ]
      expect(ids(sortTabs(tabs, "title", "asc"))).toEqual(["untitled", "titled"])
    })
  })

  describe("domain", () => {
    it("orders by domain, then title within a domain", () => {
      const tabs = [
        makeTab({ id: "z-on-a", domain: "a.com", title: "Zebra" }),
        makeTab({ id: "only-b", domain: "b.com", title: "Apple" }),
        makeTab({ id: "a-on-a", domain: "a.com", title: "Apple" }),
      ]
      expect(ids(sortTabs(tabs, "domain", "asc"))).toEqual(["a-on-a", "z-on-a", "only-b"])
    })

    it("sorts tabs with no domain first", () => {
      const tabs = [
        makeTab({ id: "has-domain", domain: "a.com", title: "Anything" }),
        makeTab({ id: "no-domain", title: "Anything" }),
      ]
      expect(ids(sortTabs(tabs, "domain", "asc"))).toEqual(["no-domain", "has-domain"])
    })
  })

  it("returns an empty array for empty input", () => {
    expect(sortTabs([], "browser", "asc")).toEqual([])
  })

  it("does not mutate the input array", () => {
    const tabs = [
      makeTab({ id: "second", windowId: 2, tabIndex: 0 }),
      makeTab({ id: "first", windowId: 1, tabIndex: 0 }),
    ]
    const sorted = sortTabs(tabs, "browser", "asc")

    expect(ids(tabs)).toEqual(["second", "first"])
    expect(sorted).not.toBe(tabs)
  })
})

describe("groupTabs", () => {
  it("returns a single unlabelled group when grouping is off", () => {
    const tabs = [makeTab({ id: "a" }), makeTab({ id: "b" })]

    expect(groupTabs(tabs, "none", {})).toEqual([
      { key: "__all", label: "", editable: false, tabs },
    ])
  })

  describe("by window", () => {
    const tabs = [
      makeTab({ id: "w7-a", windowId: 7 }),
      makeTab({ id: "w3-a", windowId: 3 }),
      makeTab({ id: "w7-b", windowId: 7 }),
    ]

    it("keeps windows in the order they first appear, not sorted by id", () => {
      const groups = groupTabs(tabs, "window", {})

      expect(groups.map((g) => g.key)).toEqual(["7", "3"])
      expect(groups.map((g) => g.label)).toEqual(["Window 1", "Window 2"])
      expect(ids(groups[0].tabs)).toEqual(["w7-a", "w7-b"])
    })

    it("marks window groups editable so they can be renamed", () => {
      expect(groupTabs(tabs, "window", {}).every((g) => g.editable)).toBe(true)
    })

    it("prefers a custom window name, and that window still consumes an auto number", () => {
      const groups = groupTabs(tabs, "window", { "7": "Research" })

      // Window 7 takes the custom name; window 3 is still numbered 2, not 1.
      expect(groups.map((g) => g.label)).toEqual(["Research", "Window 2"])
    })

    it("collects tabs with no window into a non-editable Unknown Window group", () => {
      const groups = groupTabs([makeTab({ id: "orphan" }), ...tabs], "window", {})
      const unknown = groups.find((g) => g.key === "__unknown")

      expect(unknown).toEqual({
        key: "__unknown",
        label: "Unknown Window",
        editable: false,
        tabs: [expect.objectContaining({ id: "orphan" })],
      })
      // The orphan group doesn't consume a window number.
      expect(groups.map((g) => g.label)).toEqual(["Unknown Window", "Window 1", "Window 2"])
    })
  })

  describe("by category", () => {
    it("sorts categories alphabetically and puts uncategorized last", () => {
      const tabs = [
        makeTab({ id: "none-1" }),
        makeTab({ id: "work-1", category: "work" }),
        makeTab({ id: "dev-1", category: "development" }),
      ]
      const groups = groupTabs(tabs, "category", {})

      expect(groups.map((g) => g.key)).toEqual(["development", "work", "__uncategorized"])
      expect(groups.map((g) => g.label)).toEqual(["development", "work", "Uncategorized"])
      expect(groups.every((g) => !g.editable)).toBe(true)
    })
  })

  describe("by domain", () => {
    it("sorts domains naturally and puts unknown last", () => {
      const tabs = [
        makeTab({ id: "d10", domain: "site10.com" }),
        makeTab({ id: "no-domain" }),
        makeTab({ id: "d2", domain: "site2.com" }),
      ]
      const groups = groupTabs(tabs, "domain", {})

      // Numeric-aware: site2 before site10, not lexicographic.
      expect(groups.map((g) => g.key)).toEqual(["site2.com", "site10.com", "__unknown"])
      expect(groups.at(-1)?.label).toBe("Unknown")
    })
  })

  it("returns no groups for empty input", () => {
    expect(groupTabs([], "window", {})).toEqual([])
    expect(groupTabs([], "category", {})).toEqual([])
    expect(groupTabs([], "domain", {})).toEqual([])
  })
})
