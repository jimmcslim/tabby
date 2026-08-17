import { describe, expect, it } from "bun:test"
import type { ChromeTab } from "@/types"
import { extractDomain, reconcileTabs, suspendedStateOf, type ReconcileTab } from "./reconcile"

const NOW = "2026-02-01T12:00:00.000Z"

/** A stored open row with every field filled in, so cases state only what matters. */
function dbTab(overrides: Partial<ReconcileTab> & { id: string }): ReconcileTab {
  return {
    chromeId: `ext:${overrides.id}`,
    url: `https://example.com/${overrides.id}`,
    faviconUrl: null,
    lastAccessedAt: null,
    ogImage: "https://cdn.example.com/img.png",
    description: null,
    ...overrides,
  }
}

/** A Chrome snapshot entry with every required field filled in. */
function chromeTab(overrides: Partial<ChromeTab> & { id: string }): ChromeTab {
  return {
    type: "page",
    title: `Title ${overrides.id}`,
    url: `https://example.com/${overrides.id}`,
    ...overrides,
  }
}

/** Deterministic id factory so plans are comparable. */
function ids() {
  let n = 0
  return () => `new-${++n}`
}

const plan = (dbTabs: ReconcileTab[], chromeTabs: ChromeTab[]) =>
  reconcileTabs(dbTabs, chromeTabs, { now: NOW, newId: ids() })

describe("extractDomain", () => {
  it("pulls the hostname out of a url", () => {
    expect(extractDomain("https://example.com/a/b?c=1")).toBe("example.com")
    // Non-special schemes still parse — chrome://extensions has "extensions" as its host
    expect(extractDomain("chrome://extensions")).toBe("extensions")
    // …and opaque-path schemes parse to no host at all
    expect(extractDomain("about:blank")).toBe("")
  })

  it("returns null rather than throwing on junk", () => {
    expect(extractDomain("not a url")).toBeNull()
    expect(extractDomain("")).toBeNull()
  })
})

describe("suspendedStateOf", () => {
  it("reports how Chrome shed the tab", () => {
    expect(suspendedStateOf(chromeTab({ id: "1", discarded: true }))).toBe("discarded")
    expect(suspendedStateOf(chromeTab({ id: "1", frozen: true }))).toBe("frozen")
    expect(suspendedStateOf(chromeTab({ id: "1" }))).toBeNull()
  })

  it("treats discarded as the stronger signal when Chrome reports both", () => {
    expect(suspendedStateOf(chromeTab({ id: "1", discarded: true, frozen: true }))).toBe("discarded")
  })
})

describe("reconcileTabs — inserts", () => {
  it("inserts a tab Chrome has that the db does not", () => {
    const result = plan([], [chromeTab({ id: "ext:a", windowId: 3, tabIndex: 1 })])

    expect(result.inserts).toHaveLength(1)
    expect(result.updates).toEqual([])
    expect(result.closes).toEqual([])
    expect(result.inserts[0]).toMatchObject({
      id: "new-1",
      chromeId: "ext:a",
      url: "https://example.com/ext:a",
      title: "Title ext:a",
      domain: "example.com",
      windowId: 3,
      tabIndex: 1,
      status: "open",
      type: "page",
      firstSeenAt: NOW,
      lastSeenAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  it("normalises absent optional fields to null", () => {
    const result = plan([], [chromeTab({ id: "ext:a" })])

    expect(result.inserts[0]).toMatchObject({
      faviconUrl: null,
      windowId: null,
      tabIndex: null,
      lastAccessedAt: null,
      suspendedState: null,
    })
  })

  it("records a null domain for a url it cannot parse", () => {
    const result = plan([], [chromeTab({ id: "ext:a", url: "not a url" })])

    expect(result.inserts[0].domain).toBeNull()
  })

  it("handles an empty snapshot and an empty db", () => {
    const result = plan([], [])

    expect(result).toEqual({ inserts: [], updates: [], closes: [], ogFetch: [], tweetFetch: [] })
  })
})

describe("reconcileTabs — updates", () => {
  it("updates the row whose chromeId still matches", () => {
    const result = plan(
      [dbTab({ id: "row-1", chromeId: "ext:a" })],
      [chromeTab({ id: "ext:a", url: "https://example.com/moved", title: "Moved" })],
    )

    expect(result.inserts).toEqual([])
    expect(result.closes).toEqual([])
    expect(result.updates).toHaveLength(1)
    expect(result.updates[0]).toMatchObject({
      id: "row-1",
      values: {
        chromeId: "ext:a",
        url: "https://example.com/moved",
        title: "Moved",
        lastSeenAt: NOW,
        updatedAt: NOW,
      },
    })
  })

  it("keeps the stored favicon when Chrome sends none", () => {
    const stored = dbTab({ id: "row-1", chromeId: "ext:a", faviconUrl: "https://f/icon.png" })

    expect(plan([stored], [chromeTab({ id: "ext:a" })]).updates[0].values.faviconUrl).toBe(
      "https://f/icon.png",
    )
    expect(
      plan([stored], [chromeTab({ id: "ext:a", faviconUrl: "" })]).updates[0].values.faviconUrl,
    ).toBe("https://f/icon.png")
    expect(
      plan([stored], [chromeTab({ id: "ext:a", faviconUrl: "https://f/new.png" })]).updates[0].values
        .faviconUrl,
    ).toBe("https://f/new.png")
  })

  it("keeps the stored last-accessed time when Chrome omits it", () => {
    const stored = dbTab({ id: "row-1", chromeId: "ext:a", lastAccessedAt: "2026-01-01T00:00:00Z" })

    expect(plan([stored], [chromeTab({ id: "ext:a" })]).updates[0].values.lastAccessedAt).toBe(
      "2026-01-01T00:00:00Z",
    )
    expect(
      plan([stored], [chromeTab({ id: "ext:a", lastAccessedAt: "2026-02-02T00:00:00Z" })])
        .updates[0].values.lastAccessedAt,
    ).toBe("2026-02-02T00:00:00Z")
  })
})

describe("reconcileTabs — rebinding", () => {
  it("rebinds by url when Chrome restarts and every id changes at once", () => {
    const result = plan(
      [
        dbTab({ id: "row-1", chromeId: "ext:old-1", url: "https://a.test/" }),
        dbTab({ id: "row-2", chromeId: "ext:old-2", url: "https://b.test/" }),
      ],
      [
        chromeTab({ id: "ext:new-1", url: "https://a.test/" }),
        chromeTab({ id: "ext:new-2", url: "https://b.test/" }),
      ],
    )

    // Rebound, not closed-and-reinserted: history on those rows survives
    expect(result.inserts).toEqual([])
    expect(result.closes).toEqual([])
    expect(result.updates.map((u) => u.id)).toEqual(["row-1", "row-2"])
    expect(result.updates.map((u) => u.values.chromeId)).toEqual(["ext:new-1", "ext:new-2"])
  })

  it("rebinds duplicate urls one-to-one, never letting two tabs claim one row", () => {
    const result = plan(
      [
        dbTab({ id: "row-1", chromeId: "ext:old-1", url: "https://dup.test/" }),
        dbTab({ id: "row-2", chromeId: "ext:old-2", url: "https://dup.test/" }),
      ],
      [
        chromeTab({ id: "ext:new-1", url: "https://dup.test/" }),
        chromeTab({ id: "ext:new-2", url: "https://dup.test/" }),
      ],
    )

    expect(result.updates.map((u) => u.id)).toEqual(["row-1", "row-2"])
    expect(result.inserts).toEqual([])
    expect(result.closes).toEqual([])
  })

  it("closes the surplus row when duplicates shrink to one open tab", () => {
    const result = plan(
      [
        dbTab({ id: "row-1", chromeId: "ext:old-1", url: "https://dup.test/" }),
        dbTab({ id: "row-2", chromeId: "ext:old-2", url: "https://dup.test/" }),
      ],
      [chromeTab({ id: "ext:new-1", url: "https://dup.test/" })],
    )

    expect(result.updates.map((u) => u.id)).toEqual(["row-1"])
    expect(result.closes).toEqual(["row-2"])
    expect(result.inserts).toEqual([])
  })

  it("inserts the surplus tab when duplicates grow beyond the stored rows", () => {
    const result = plan(
      [dbTab({ id: "row-1", chromeId: "ext:old-1", url: "https://dup.test/" })],
      [
        chromeTab({ id: "ext:new-1", url: "https://dup.test/" }),
        chromeTab({ id: "ext:new-2", url: "https://dup.test/" }),
      ],
    )

    expect(result.updates.map((u) => u.id)).toEqual(["row-1"])
    expect(result.inserts.map((i) => i.chromeId)).toEqual(["ext:new-2"])
    expect(result.closes).toEqual([])
  })

  it("treats a row with no chromeId as a rebind candidate", () => {
    const result = plan(
      [dbTab({ id: "row-1", chromeId: null, url: "https://a.test/" })],
      [chromeTab({ id: "ext:new-1", url: "https://a.test/" })],
    )

    expect(result.updates).toHaveLength(1)
    expect(result.updates[0].id).toBe("row-1")
    expect(result.updates[0].values.chromeId).toBe("ext:new-1")
    expect(result.closes).toEqual([])
  })

  it("does not rebind across different urls", () => {
    const result = plan(
      [dbTab({ id: "row-1", chromeId: "ext:old-1", url: "https://a.test/" })],
      [chromeTab({ id: "ext:new-1", url: "https://b.test/" })],
    )

    expect(result.closes).toEqual(["row-1"])
    expect(result.inserts.map((i) => i.chromeId)).toEqual(["ext:new-1"])
    expect(result.updates).toEqual([])
  })

  it("leaves a still-matching row alone rather than offering it for rebind", () => {
    // row-1 keeps its id; the new tab shares its url but must not steal the row
    const result = plan(
      [dbTab({ id: "row-1", chromeId: "ext:a", url: "https://same.test/" })],
      [
        chromeTab({ id: "ext:a", url: "https://same.test/" }),
        chromeTab({ id: "ext:b", url: "https://same.test/" }),
      ],
    )

    expect(result.updates.map((u) => u.id)).toEqual(["row-1"])
    expect(result.inserts.map((i) => i.chromeId)).toEqual(["ext:b"])
    expect(result.closes).toEqual([])
  })
})

describe("reconcileTabs — closes", () => {
  it("closes an open row Chrome no longer reports", () => {
    const result = plan(
      [
        dbTab({ id: "row-1", chromeId: "ext:a" }),
        dbTab({ id: "row-2", chromeId: "ext:b", url: "https://gone.test/" }),
      ],
      [chromeTab({ id: "ext:a", url: "https://example.com/row-1" })],
    )

    expect(result.closes).toEqual(["row-2"])
  })

  it("closes an orphaned null-chromeId row that matched no url", () => {
    const result = plan([dbTab({ id: "row-1", chromeId: null, url: "https://gone.test/" })], [])

    expect(result.closes).toEqual(["row-1"])
  })

  it("closes everything when Chrome reports an empty window set", () => {
    const result = plan([dbTab({ id: "row-1" }), dbTab({ id: "row-2" })], [])

    expect(result.closes).toEqual(["row-1", "row-2"])
    expect(result.inserts).toEqual([])
    expect(result.updates).toEqual([])
  })
})

describe("reconcileTabs — enrichment queueing", () => {
  it("queues a new http tab for an OG fetch", () => {
    const result = plan([], [chromeTab({ id: "ext:a", url: "https://news.test/story" })])

    expect(result.ogFetch).toEqual([{ id: "new-1", url: "https://news.test/story" }])
    expect(result.tweetFetch).toEqual([])
  })

  it("queues a new tweet for tweet data instead of an OG fetch", () => {
    const result = plan([], [chromeTab({ id: "ext:a", url: "https://x.com/user/status/123" })])

    expect(result.tweetFetch).toEqual([{ id: "new-1", url: "https://x.com/user/status/123" }])
    expect(result.ogFetch).toEqual([])
  })

  it("queues neither for a non-http scheme", () => {
    const result = plan([], [chromeTab({ id: "ext:a", url: "chrome://extensions" })])

    expect(result.ogFetch).toEqual([])
    expect(result.tweetFetch).toEqual([])
  })

  it("queues an existing tab whose OG image was never checked", () => {
    const result = plan(
      [dbTab({ id: "row-1", chromeId: "ext:a", ogImage: null })],
      [chromeTab({ id: "ext:a", url: "https://example.com/row-1" })],
    )

    expect(result.ogFetch).toEqual([{ id: "row-1", url: "https://example.com/row-1" }])
  })

  it('does not re-queue a tab already checked and found to have none ("")', () => {
    const result = plan(
      [dbTab({ id: "row-1", chromeId: "ext:a", ogImage: "" })],
      [chromeTab({ id: "ext:a", url: "https://example.com/row-1" })],
    )

    expect(result.ogFetch).toEqual([])
  })

  it("re-queues when the url changed, even with an image already stored", () => {
    const result = plan(
      [dbTab({ id: "row-1", chromeId: "ext:a", url: "https://old.test/", ogImage: "" })],
      [chromeTab({ id: "ext:a", url: "https://new.test/" })],
    )

    expect(result.ogFetch).toEqual([{ id: "row-1", url: "https://new.test/" }])
  })

  it("leaves an unchanged, already-enriched tab alone", () => {
    const result = plan(
      [dbTab({ id: "row-1", chromeId: "ext:a", ogImage: "https://cdn/i.png" })],
      [chromeTab({ id: "ext:a", url: "https://example.com/row-1" })],
    )

    expect(result.ogFetch).toEqual([])
    expect(result.tweetFetch).toEqual([])
  })

  it("does not re-fetch tweet data once a description is stored", () => {
    const result = plan(
      [
        dbTab({
          id: "row-1",
          chromeId: "ext:a",
          url: "https://x.com/user/status/1",
          description: '{"text":"hi"}',
          ogImage: "https://pbs.twimg.com/i.jpg",
        }),
      ],
      [chromeTab({ id: "ext:a", url: "https://x.com/user/status/1" })],
    )

    expect(result.tweetFetch).toEqual([])
    expect(result.ogFetch).toEqual([])
  })

  it("queues a rebound tab under its existing row id, not a fresh one", () => {
    const result = plan(
      [dbTab({ id: "row-1", chromeId: "ext:old", url: "https://a.test/", ogImage: null })],
      [chromeTab({ id: "ext:new", url: "https://a.test/" })],
    )

    expect(result.ogFetch).toEqual([{ id: "row-1", url: "https://a.test/" }])
    expect(result.inserts).toEqual([])
  })
})

describe("reconcileTabs — counts", () => {
  it("plan sizes are what the sync result reports", () => {
    const result = plan(
      [
        dbTab({ id: "row-1", chromeId: "ext:a" }),
        dbTab({ id: "row-2", chromeId: "ext:b", url: "https://gone.test/" }),
      ],
      [
        chromeTab({ id: "ext:a", url: "https://example.com/row-1" }),
        chromeTab({ id: "ext:c", url: "https://fresh.test/" }),
      ],
    )

    expect(result.updates).toHaveLength(1) // added: ext:a matched row-1
    expect(result.inserts).toHaveLength(1) // added: ext:c is new
    expect(result.closes).toHaveLength(1) // closed: row-2 vanished
  })
})
