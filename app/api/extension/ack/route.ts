import { resolveAck } from "@/lib/extension/bridge"
import { NextResponse } from "next/server"
import type { ExtensionCommandAck } from "@/types"

export async function POST(request: Request) {
  try {
    const ack = (await request.json()) as ExtensionCommandAck
    if (typeof ack?.commandId !== "string") {
      return NextResponse.json({ error: "Missing commandId" }, { status: 400 })
    }
    resolveAck(ack)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ack failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
