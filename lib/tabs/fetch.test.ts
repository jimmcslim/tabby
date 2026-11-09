import { afterEach, describe, expect, it } from "bun:test"
import type { Tab } from "@/types"
import { fetchAllTabs, fetchTabsPage } from "./fetch"
import { MAX_PAGE_SIZE } from "./paging"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const tab = (id: string) => ({ id }) as Tab

/** A fake /api/tabs that serves `pages` in order and records each request URL. */
function mockPages(pages: ({ tabs: Tab[]; nextCursor: string | null } | "fail")[]) {
  const urls: string[] = []
  let i = 0
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(String(input))
    const page = pages[i++]
    if (page === "fail") return new Response("{}", { status: 500 })
    return new Response(JSON.stringify(page), { status: 200 })
  }) as typeof fetch
  return urls
}

describe("fetchAllTabs", () => {
  it("follows cursors until the last page and concatenates in order", async () => {
    const urls = mockPages([
      { tabs: [tab("a"), tab("b")], nextCursor: "c1" },
      { tabs: [tab("c")], nextCursor: "c2" },
      { tabs: [tab("d")], nextCursor: null },
    ])
    expect((await fetchAllTabs("open"))?.map((t) => t.id)).toEqual(["a", "b", "c", "d"])
    expect(urls).toHaveLength(3)
    expect(urls[0]).toContain("status=open")
    expect(urls[0]).toContain(`limit=${MAX_PAGE_SIZE}`)
    expect(urls[0]).not.toContain("cursor=")
    expect(urls[1]).toContain("cursor=c1")
    expect(urls[2]).toContain("cursor=c2")
  })

  it("makes a single request when everything fits one page", async () => {
    const urls = mockPages([{ tabs: [tab("a")], nextCursor: null }])
    expect((await fetchAllTabs("open"))?.map((t) => t.id)).toEqual(["a"])
    expect(urls).toHaveLength(1)
  })

  it("returns null rather than a truncated list if any page fails", async () => {
    mockPages([{ tabs: [tab("a")], nextCursor: "c1" }, "fail"])
    expect(await fetchAllTabs("open")).toBeNull()
  })
})

describe("fetchTabsPage", () => {
  it("sends only the params it was given", async () => {
    const urls = mockPages([{ tabs: [], nextCursor: null }])
    await fetchTabsPage({ status: "closed", search: "news", limit: 50, cursor: "xyz" })
    expect(urls[0]).toContain("status=closed")
    expect(urls[0]).toContain("search=news")
    expect(urls[0]).toContain("limit=50")
    expect(urls[0]).toContain("cursor=xyz")

    const urls2 = mockPages([{ tabs: [], nextCursor: null }])
    await fetchTabsPage({ status: "closed", search: "" })
    expect(urls2[0]).toBe("/api/tabs?status=closed")
  })

  it("returns null on a non-2xx or network error", async () => {
    mockPages(["fail"])
    expect(await fetchTabsPage({ status: "open" })).toBeNull()
    globalThis.fetch = (async () => {
      throw new Error("offline")
    }) as unknown as typeof fetch
    expect(await fetchTabsPage({ status: "open" })).toBeNull()
  })
})
