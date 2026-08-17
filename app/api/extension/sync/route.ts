import { syncTabsFromList } from "@/lib/chrome/sync"
import { recordReport, drainBacklog, isRestoreLocked } from "@/lib/extension/bridge"
import { autoProcessTabs } from "@/lib/ai/auto-process"
import { NextResponse } from "next/server"
import type { ExtensionSnapshot } from "@/types"

const EMPTY_RESULT = { added: 0, updated: 0, closed: 0, total: 0 }

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ExtensionSnapshot
    if (!Array.isArray(body?.tabs)) {
      return NextResponse.json({ error: "Missing tabs array" }, { status: 400 })
    }

    // During a bulk restore, Chrome fires onCreated for every reopened tab,
    // and each snapshot push would otherwise trigger a full tabs-table diff,
    // session rewrite, OG fetches and AI processing — starving the restore
    // loop's own openTab acks. Skip all of that; still deliver queued commands
    // (the restore's open commands ride the backlog when SSE is down) and keep
    // the extension marked fresh. The next normal sync reconciles everything.
    if (isRestoreLocked()) {
      recordReport(body.extensionVersion || "unknown", EMPTY_RESULT)
      return NextResponse.json({ result: null, commands: drainBacklog() })
    }

    const result = await syncTabsFromList(body.tabs, { isStartup: !!body.isStartup })
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
