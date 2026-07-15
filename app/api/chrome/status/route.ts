import { getBridge, isExtensionSseConnected, isExtensionFresh } from "@/lib/extension/bridge"
import { NextResponse } from "next/server"
import type { ChromeStatus } from "@/types"

export async function GET() {
  const bridge = getBridge()
  const sse = isExtensionSseConnected()
  const connected = sse || isExtensionFresh()

  const status: ChromeStatus = {
    connected,
    source: connected ? "extension" : "none",
    browser: connected ? "Chrome (extension)" : undefined,
    version: bridge.extensionVersion,
    extension: {
      connected,
      sse,
      lastReportAt: bridge.lastReportAt ? new Date(bridge.lastReportAt).toISOString() : null,
      version: bridge.extensionVersion,
    },
  }
  return NextResponse.json(status)
}
