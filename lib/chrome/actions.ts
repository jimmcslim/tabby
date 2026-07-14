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

export async function openTab(url: string): Promise<ChromeTab> {
  if (isExtensionSseConnected()) {
    const data = (await dispatchCommand({ type: "open", url })) as {
      id: string
      windowId?: number
      url?: string
      title?: string
    }
    return {
      id: data.id,
      type: "page",
      title: data.title || url,
      url: data.url || url,
      windowId: data.windowId ?? null,
    }
  }
  return cdp.openTab(url)
}
