import { syncTabsFromList } from "@/lib/chrome/sync"
import { unwrapWorkonaUrl } from "@/lib/chrome/workona"
import { recordReport, drainBacklog } from "@/lib/extension/bridge"
import { autoProcessTabs } from "@/lib/ai/auto-process"
import { NextResponse } from "next/server"
import type { ChromeTab, ExtensionSnapshot } from "@/types"

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ExtensionSnapshot
    if (!Array.isArray(body?.tabs)) {
      return NextResponse.json({ error: "Missing tabs array" }, { status: 400 })
    }

    const chromeTabs: ChromeTab[] = body.tabs.map((t) => {
      const workona = unwrapWorkonaUrl(t.url)
      return {
        ...t,
        title: workona?.title || t.title,
        url: workona?.url ?? t.url,
        faviconUrl: workona?.faviconUrl || t.faviconUrl || undefined,
        suspended: !!workona,
      }
    })

    const result = await syncTabsFromList(chromeTabs)
    recordReport(body.extensionVersion || "unknown", result)

    // Fire-and-forget: auto-classify and summarize new tabs in the background
    autoProcessTabs().catch((e) =>
      console.error("[extension-sync] auto-process error:", e),
    )

    return NextResponse.json({ result, commands: drainBacklog() })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
