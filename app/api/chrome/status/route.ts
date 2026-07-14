import { getChromeStatus } from "@/lib/chrome/cdp"
import { getBridge, isExtensionSseConnected, isExtensionFresh } from "@/lib/extension/bridge"
import { NextResponse } from "next/server"
import type { ChromeStatus } from "@/types"

export async function GET() {
  const debugUrl = process.env.CHROME_DEBUG_URL || "http://localhost:9222"

  // Prefer the extension: while it's live, never touch CDP (avoids Chrome's
  // "being debugged" banner).
  const sse = isExtensionSseConnected()
  if (sse || (await isExtensionFresh())) {
    const bridge = getBridge()
    const status: ChromeStatus = {
      connected: true,
      source: "extension",
      browser: "Chrome (extension)",
      version: bridge.extensionVersion,
      debugUrl,
      extension: {
        connected: true,
        sse,
        lastReportAt: bridge.lastReportAt ? new Date(bridge.lastReportAt).toISOString() : null,
        version: bridge.extensionVersion,
      },
    }
    return NextResponse.json(status)
  }

  const cdpStatus = await getChromeStatus()
  const status: ChromeStatus = {
    ...cdpStatus,
    source: cdpStatus.connected ? "cdp" : "none",
    debugUrl,
  }
  return NextResponse.json(status)
}
