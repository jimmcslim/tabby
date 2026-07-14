import { addSubscriber, drainBacklog } from "@/lib/extension/bridge"
import type { NextRequest } from "next/server"
import type { ExtensionEvent } from "@/types"

export const dynamic = "force-dynamic"

const PING_INTERVAL_MS = 20_000 // under Chrome's ~30s MV3 service-worker idle limit

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      let closed = false
      const send = (event: ExtensionEvent) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          closed = true
        }
      }

      send({ type: "connected" })
      for (const command of drainBacklog()) send({ type: "command", command })

      const unsubscribe = addSubscriber((command) => send({ type: "command", command }))
      const ping = setInterval(() => send({ type: "ping" }), PING_INTERVAL_MS)

      request.signal.addEventListener("abort", () => {
        closed = true
        clearInterval(ping)
        unsubscribe()
        try {
          controller.close()
        } catch {
          // already closed
        }
      })
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
