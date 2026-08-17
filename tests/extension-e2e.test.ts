import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test"
import { FakeExtension } from "./fake-extension"
import { startTestServer, type TestServer } from "./server"
import type { Group, Session, SessionTab, Tab } from "@/types"

/**
 * End-to-end coverage of the extension bridge: a fake Chrome (see
 * fake-extension.ts) pushes snapshots at a real server backed by a scratch
 * database, and we assert on what the HTTP API says happened. No browser, no
 * Ollama, no network beyond localhost.
 *
 * The whole file shares one server and one database — booting is the slow part
 * — so each test starts by clearing the fake's tab strip and syncing, which
 * makes the previous test's tabs closed rows and leaves this test's tabs the
 * only open ones. URLs are kept distinct per test so nothing collides.
 */

const BOOT_TIMEOUT_MS = 200_000
const TEST_TIMEOUT_MS = 30_000

let server: TestServer
let ext: FakeExtension

const url = (path: string) => `https://example.test${path}`

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(server.baseUrl + path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  })
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status}`)
  return (await res.json()) as T
}

const openTabs = () => api<Tab[]>("/api/tabs?status=open")
const closedTabs = () => api<Tab[]>("/api/tabs?status=closed")
const sessions = () => api<Session[]>("/api/sessions")

async function sessionNamed(name: string): Promise<Session> {
  const found = (await sessions()).find((s) => s.name === name)
  if (!found) throw new Error(`No session named ${name}`)
  return found
}

const sessionTabs = (id: string) =>
  api<Session & { tabs: SessionTab[] }>(`/api/sessions/${id}`).then((s) => s.tabs)

beforeAll(async () => {
  server = await startTestServer()
  ext = new FakeExtension(server.baseUrl)
  await ext.connect()
}, BOOT_TIMEOUT_MS)

afterAll(async () => {
  await ext?.disconnect()
  await server?.stop()
})

beforeEach(async () => {
  ext.closeAllTabs()
  await ext.sync()
})

describe("snapshot sync", () => {
  it(
    "adds tabs on first sight and closes the ones that disappear",
    async () => {
      const keep = ext.openTab({ url: url("/keep"), title: "Keep" })
      const drop = ext.openTab({ url: url("/drop"), title: "Drop" })

      const added = await ext.sync()
      expect(added).toMatchObject({ added: 2, closed: 0, total: 2 })
      expect((await openTabs()).map((t) => t.url).sort()).toEqual([url("/drop"), url("/keep")])

      ext.closeTab(drop.id)
      const reconciled = await ext.sync()
      expect(reconciled).toMatchObject({ added: 0, updated: 1, closed: 1, total: 1 })

      expect((await openTabs()).map((t) => t.url)).toEqual([url("/keep")])
      expect((await closedTabs()).map((t) => t.url)).toContain(url("/drop"))

      // The surviving tab keeps its identity rather than being re-added.
      const [row] = await openTabs()
      expect(row.chromeId).toBe(`ext:${keep.id}`)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "reports the extension as connected",
    async () => {
      const status = await api<{ connected: boolean; extension?: { sse: boolean } }>(
        "/api/chrome/status",
      )
      expect(status.connected).toBe(true)
      expect(status.extension?.sse).toBe(true)
    },
    TEST_TIMEOUT_MS,
  )
})

describe("auto-sessions", () => {
  it(
    "mirrors the open tabs into Latest on every sync",
    async () => {
      ext.openTab({ url: url("/latest-a"), title: "A" })
      ext.openTab({ url: url("/latest-b"), title: "B" })
      await ext.sync()

      const latest = await sessionNamed("Latest")
      expect(latest.isAuto).toBe(true)
      expect(latest.tabCount).toBe(2)
      expect((await sessionTabs(latest.id)).map((t) => t.url).sort()).toEqual([
        url("/latest-a"),
        url("/latest-b"),
      ])

      ext.closeAllTabs()
      ext.openTab({ url: url("/latest-c"), title: "C" })
      await ext.sync()

      const afterwards = await sessionNamed("Latest")
      expect(afterwards.tabCount).toBe(1)
      expect((await sessionTabs(afterwards.id)).map((t) => t.url)).toEqual([url("/latest-c")])
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "snapshots the pre-restart tabs into Previous Session on a startup sync",
    async () => {
      ext.openTab({ url: url("/before-restart-a"), title: "Before A" })
      ext.openTab({ url: url("/before-restart-b"), title: "Before B" })
      await ext.sync()

      // Chrome relaunches with a different tab set; the first push after
      // chrome.runtime.onStartup carries isStartup.
      ext.closeAllTabs()
      ext.openTab({ url: url("/after-restart"), title: "After" })
      await ext.sync({ isStartup: true })

      const previous = await sessionNamed("Previous Session")
      expect(previous.isPrevious).toBe(true)
      expect((await sessionTabs(previous.id)).map((t) => t.url).sort()).toEqual([
        url("/before-restart-a"),
        url("/before-restart-b"),
      ])

      // Latest tracks what is open *now*, not what was.
      expect((await sessionTabs((await sessionNamed("Latest")).id)).map((t) => t.url)).toEqual([
        url("/after-restart"),
      ])
    },
    TEST_TIMEOUT_MS,
  )
})

describe("manual session save and restore", () => {
  it(
    "saves the open tabs and reopens them through the command channel",
    async () => {
      const saved = [url("/saved-1"), url("/saved-2"), url("/saved-3")]
      for (const u of saved) ext.openTab({ url: u, title: `Saved ${u}`, faviconUrl: `${u}/icon` })
      await ext.sync()

      const session = await api<Session>("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ name: "Work" }),
      })
      expect(session.tabCount).toBe(3)

      // Chrome quits: the tabs are gone from the strip and from `tabs`.
      ext.closeAllTabs()
      await ext.sync()
      expect(await openTabs()).toHaveLength(0)

      const result = await api<{ restored: number; total: number }>(
        `/api/sessions/${session.id}/restore`,
        { method: "POST" },
      )
      expect(result).toEqual({ restored: 3, total: 3 })

      // Each tab came back as an `open` command over SSE, and — because a
      // restore must not load hundreds of pages at once — behind the
      // suspended placeholder.
      const opens = ext.commands.filter((c) => c.type === "open")
      expect(opens).toHaveLength(3)
      expect(opens.map((c) => c.url).sort()).toEqual([...saved].sort())
      expect(opens.every((c) => c.suspend === true && c.active === false)).toBe(true)
      expect(ext.urls.sort()).toEqual([...saved].sort())

      // The restore's own follow-up sync brings the database current without
      // waiting on the extension's next scheduled push.
      expect((await openTabs()).map((t) => t.url).sort()).toEqual([...saved].sort())
    },
    TEST_TIMEOUT_MS,
  )
})

describe("groups", () => {
  it(
    "holds a membership that survives a sync, and gives it up on removal",
    async () => {
      ext.openTab({ url: url("/grouped"), title: "Grouped" })
      ext.openTab({ url: url("/ungrouped"), title: "Ungrouped" })
      await ext.sync()

      const grouped = (await openTabs()).find((t) => t.url === url("/grouped"))!
      const group = await api<Group>("/api/groups", {
        method: "POST",
        body: JSON.stringify({ name: "Reading", color: "blue", tabIds: [grouped.id] }),
      })

      const listed = (await api<Group[]>("/api/groups")).find((g) => g.id === group.id)
      expect(listed?.tabCount).toBe(1)

      // A membership is by tab id, so a re-sync of the same tab leaves it alone.
      await ext.sync()
      const members = await api<Tab[]>(`/api/groups/${group.id}/tabs`)
      expect(members.map((t) => t.url)).toEqual([url("/grouped")])

      await api(`/api/groups/${group.id}/tabs`, {
        method: "POST",
        body: JSON.stringify({ tabIds: [grouped.id], action: "remove" }),
      })
      expect(await api<Tab[]>(`/api/groups/${group.id}/tabs`)).toHaveLength(0)
    },
    TEST_TIMEOUT_MS,
  )
})

describe("settings", () => {
  it(
    "round-trips the sync interval and clamps it to the allowed range",
    async () => {
      expect(await api<{ syncIntervalSeconds: number }>("/api/settings")).toEqual({
        syncIntervalSeconds: 30,
      })

      const put = (syncIntervalSeconds: number) =>
        api<{ syncIntervalSeconds: number }>("/api/settings", {
          method: "PUT",
          body: JSON.stringify({ syncIntervalSeconds }),
        })

      expect(await put(15)).toEqual({ syncIntervalSeconds: 15 })
      expect(await api<{ syncIntervalSeconds: number }>("/api/settings")).toEqual({
        syncIntervalSeconds: 15,
      })

      expect(await put(1)).toEqual({ syncIntervalSeconds: 5 })
      expect(await put(99_999)).toEqual({ syncIntervalSeconds: 3600 })
    },
    TEST_TIMEOUT_MS,
  )
})
