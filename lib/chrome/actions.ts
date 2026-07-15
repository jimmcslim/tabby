import { isExtensionSseConnected, dispatchCommand } from "@/lib/extension/bridge"
import type { ChromeTab } from "@/types"

// All tab actions execute in Chrome via the Tabby Connector extension.
// chromeIds carry an "ext:<chrome.tabs id>" prefix; rows with a stale id from
// an older source self-heal via the URL-rebind pass on the next snapshot.

const EXT_PREFIX = "ext:"

function extTabId(chromeId: string): number {
  if (!chromeId.startsWith(EXT_PREFIX)) {
    throw new Error("Tab has a stale id — try syncing first")
  }
  return Number(chromeId.slice(EXT_PREFIX.length))
}

function requireExtension(): void {
  if (!isExtensionSseConnected()) {
    throw new Error("Tabby extension is not connected")
  }
}

export async function focusTab(chromeId: string): Promise<void> {
  requireExtension()
  await dispatchCommand({ type: "focus", tabId: extTabId(chromeId) })
}

export async function closeTab(chromeId: string): Promise<void> {
  requireExtension()
  await dispatchCommand({ type: "close", tabId: extTabId(chromeId) })
}

/**
 * Suspend a tab via chrome.tabs.discard — frees its memory but keeps it in
 * the tab strip. Returns the tab's new chromeId (discarding replaces the tab,
 * so Chrome assigns a new id).
 */
export async function discardTab(chromeId: string): Promise<string | null> {
  requireExtension()
  const data = (await dispatchCommand({ type: "discard", tabId: extTabId(chromeId) })) as
    | { id?: string }
    | undefined
  return data?.id ?? null
}

export async function openTab(url?: string, windowId?: number): Promise<ChromeTab> {
  requireExtension()
  const data = (await dispatchCommand({ type: "open", url, windowId })) as {
    id: string
    windowId?: number
    url?: string
    title?: string
  }
  return {
    id: data.id,
    type: "page",
    title: data.title || data.url || url || "New tab",
    url: data.url || url || "chrome://newtab/",
    windowId: data.windowId ?? null,
  }
}
