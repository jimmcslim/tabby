// Tabby Connector — MV3 service worker.
// Pushes full tab snapshots to the Tabby server and holds an SSE stream open
// so the server can dispatch tab commands (focus/close/open/snapshot) instantly.

const DEFAULT_BASE_URL = "http://localhost:3000"
const SNAPSHOT_DEBOUNCE_MS = 500
const BACKOFF_MIN_MS = 1000
const BACKOFF_MAX_MS = 30000

const VERSION = chrome.runtime.getManifest().version

let sseConnected = false
let backoffMs = BACKOFF_MIN_MS
let connecting = false
let snapshotTimer = null
let snapshotInFlight = false
let snapshotQueued = false

async function getBaseUrl() {
  const { baseUrl } = await chrome.storage.local.get({ baseUrl: DEFAULT_BASE_URL })
  return baseUrl.replace(/\/+$/, "")
}

// --- Snapshot push -----------------------------------------------------------

function tabToChromeTab(t) {
  return {
    id: "ext:" + t.id,
    type: "page",
    title: t.title || t.url,
    url: t.url,
    faviconUrl: t.favIconUrl || null,
    windowId: t.windowId,
  }
}

async function pushSnapshot() {
  if (snapshotInFlight) {
    snapshotQueued = true
    return null
  }
  snapshotInFlight = true
  try {
    const baseUrl = await getBaseUrl()
    const allTabs = await chrome.tabs.query({})
    const tabs = allTabs.filter((t) => t.id !== chrome.tabs.TAB_ID_NONE && t.url).map(tabToChromeTab)

    const res = await fetch(baseUrl + "/api/extension/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extensionVersion: VERSION, tabs }),
    })
    if (!res.ok) throw new Error("sync failed: " + res.status)
    const body = await res.json()

    // Commands queued while SSE was down piggyback on the sync response
    for (const command of body.commands || []) {
      executeCommand(command) // fire-and-forget; each acks itself
    }
    return body.result
  } catch (e) {
    console.warn("[tabby] snapshot push failed:", e.message)
    return null
  } finally {
    snapshotInFlight = false
    if (snapshotQueued) {
      snapshotQueued = false
      scheduleSnapshot()
    }
  }
}

function scheduleSnapshot() {
  if (snapshotTimer) clearTimeout(snapshotTimer)
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null
    pushSnapshot()
  }, SNAPSHOT_DEBOUNCE_MS)
}

chrome.tabs.onCreated.addListener(scheduleSnapshot)
chrome.tabs.onRemoved.addListener(scheduleSnapshot)
chrome.tabs.onMoved.addListener(scheduleSnapshot)
chrome.tabs.onActivated.addListener(scheduleSnapshot)
chrome.tabs.onAttached.addListener(scheduleSnapshot)
chrome.tabs.onDetached.addListener(scheduleSnapshot)
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.title || changeInfo.status === "complete") {
    scheduleSnapshot()
  }
})
chrome.windows.onCreated.addListener(() => {
  scheduleSnapshot()
  ensurePinnedTabs()
})
chrome.windows.onRemoved.addListener(scheduleSnapshot)

// --- Command execution -------------------------------------------------------

async function executeCommand(command) {
  const ack = { commandId: command.id, ok: true }
  try {
    switch (command.type) {
      case "focus": {
        const tab = await chrome.tabs.update(command.tabId, { active: true })
        await chrome.windows.update(tab.windowId, { focused: true })
        break
      }
      case "close": {
        await chrome.tabs.remove(command.tabId)
        break
      }
      case "open": {
        const tab = await chrome.tabs.create({ url: command.url })
        ack.data = {
          id: "ext:" + tab.id,
          windowId: tab.windowId,
          url: tab.pendingUrl || tab.url || command.url,
          title: tab.title || command.url,
        }
        break
      }
      case "snapshot": {
        ack.data = await pushSnapshot()
        break
      }
      default:
        throw new Error("Unknown command: " + command.type)
    }
  } catch (e) {
    ack.ok = false
    ack.error = e.message
  }

  try {
    const baseUrl = await getBaseUrl()
    await fetch(baseUrl + "/api/extension/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ack),
    })
  } catch (e) {
    console.warn("[tabby] ack failed:", e.message)
  }
}

// --- SSE command stream ------------------------------------------------------

async function connectEvents() {
  if (connecting || sseConnected) return
  connecting = true
  try {
    const baseUrl = await getBaseUrl()
    const res = await fetch(baseUrl + "/api/extension/events")
    if (!res.ok || !res.body) throw new Error("events stream failed: " + res.status)

    sseConnected = true
    backoffMs = BACKOFF_MIN_MS
    console.log("[tabby] SSE connected")
    pushSnapshot()

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let sep
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)

        // Any extension API call resets the MV3 idle timer, so the server's
        // 20s pings keep this worker alive while the stream is open.
        chrome.runtime.getPlatformInfo()

        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue
          let event
          try {
            event = JSON.parse(line.slice(6))
          } catch {
            continue
          }
          if (event.type === "command") executeCommand(event.command)
        }
      }
    }
  } catch (e) {
    console.warn("[tabby] SSE error:", e.message)
  } finally {
    connecting = false
    if (sseConnected) console.log("[tabby] SSE disconnected")
    sseConnected = false
    setTimeout(connectEvents, backoffMs)
    backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS)
  }
}

// --- Pinned Tabby tab (Workona-style) ----------------------------------------

async function ensurePinnedTabs() {
  try {
    const baseUrl = await getBaseUrl()
    const windows = await chrome.windows.getAll({ windowTypes: ["normal"] })

    for (const win of windows) {
      const tabs = await chrome.tabs.query({ windowId: win.id })
      const tabbyTab = tabs.find((t) => (t.url || t.pendingUrl || "").startsWith(baseUrl))

      if (!tabbyTab) {
        await chrome.tabs.create({
          windowId: win.id,
          url: baseUrl,
          pinned: true,
          index: 0,
          active: false,
        })
      } else if (!tabbyTab.pinned || tabbyTab.index !== 0) {
        if (!tabbyTab.pinned) await chrome.tabs.update(tabbyTab.id, { pinned: true })
        if (tabbyTab.index !== 0) await chrome.tabs.move(tabbyTab.id, { index: 0 })
      }
    }
  } catch (e) {
    console.warn("[tabby] ensurePinnedTabs failed:", e.message)
  }
}

// --- Lifecycle ---------------------------------------------------------------

// Watchdog: reconnect SSE if dropped, full safety sync, and keep pinned tabs.
chrome.alarms.create("tabby-watchdog", { periodInMinutes: 0.5 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "tabby-watchdog") return
  connectEvents()
  pushSnapshot()
  ensurePinnedTabs()
})

chrome.runtime.onInstalled.addListener(() => {
  ensurePinnedTabs()
  pushSnapshot()
})
chrome.runtime.onStartup.addListener(() => {
  ensurePinnedTabs()
  pushSnapshot()
})

// Popup messages
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "sync-now") {
    pushSnapshot().then((result) => sendResponse({ result, sseConnected }))
    return true // async response
  }
  if (message?.type === "status") {
    sendResponse({ sseConnected })
  }
})

// The worker script runs on every wake — always try to (re)connect.
connectEvents()
