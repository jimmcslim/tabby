import * as cdp from "./cdp"
import { isExtensionSseConnected, dispatchCommand } from "@/lib/extension/bridge"
import type { ChromeTab } from "@/types"

// Extension-sourced tabs carry an "ext:<chrome.tabs id>" chromeId; CDP tabs a
// targetId GUID. Route each action to the source that owns the id.

const EXT_PREFIX = "ext:"

function extTabId(chromeId: string): number {
  return Number(chromeId.slice(EXT_PREFIX.length))
}

function requireExtension(): void {
  if (!isExtensionSseConnected()) {
    throw new Error("Tabby extension is not connected")
  }
}

export async function focusTab(chromeId: string): Promise<void> {
  if (chromeId.startsWith(EXT_PREFIX)) {
    requireExtension()
    await dispatchCommand({ type: "focus", tabId: extTabId(chromeId) })
    return
  }
  await cdp.focusTab(chromeId)
}

export async function closeTab(chromeId: string): Promise<void> {
  if (chromeId.startsWith(EXT_PREFIX)) {
    requireExtension()
    await dispatchCommand({ type: "close", tabId: extTabId(chromeId) })
    return
  }
  await cdp.closeTab(chromeId)
}

/**
 * Suspend a tab via chrome.tabs.discard — frees its memory but keeps it in
 * the tab strip. Extension-only (CDP has no discard). Returns the tab's new
 * chromeId (discarding replaces the tab, so Chrome assigns a new id).
 */
export async function discardTab(chromeId: string): Promise<string | null> {
  if (!chromeId.startsWith(EXT_PREFIX)) {
    throw new Error("Suspending tabs requires the Tabby extension")
  }
  requireExtension()
  const data = (await dispatchCommand({ type: "discard", tabId: extTabId(chromeId) })) as
    | { id?: string }
    | undefined
  return data?.id ?? null
}

export async function openTab(url?: string, windowId?: number): Promise<ChromeTab> {
  if (isExtensionSseConnected()) {
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
  // CDP can't target a window and needs a URL
  return cdp.openTab(url || "chrome://newtab/")
}
