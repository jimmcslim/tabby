"use client"

import { useCallback, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { SuspendStaleDialog } from "@/components/dialogs/suspend-stale-dialog"
import type { Tab } from "@/types"
import { HugeiconsIcon } from "@hugeicons/react"
import { SleepingIcon } from "@hugeicons/core-free-icons"

/**
 * "Suspend Stale" — owns the staleness check, the confirm dialog and the
 * suspend call. The caller only says what to do once tabs have been suspended.
 */
export function SuspendStaleAction({ onSuspended }: { onSuspended: () => void }) {
  const [open, setOpen] = useState(false)
  const [staleTabs, setStaleTabs] = useState<Tab[]>([])
  const [closing, setClosing] = useState(false)

  const check = useCallback(async () => {
    const res = await fetch("/api/tabs/stale?hours=24")
    if (res.ok) {
      const data = await res.json()
      setStaleTabs(data.tabs)
      setOpen(true)
    }
  }, [])

  const confirm = useCallback(async () => {
    setClosing(true)
    try {
      const res = await fetch("/api/tabs/stale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tabIds: staleTabs.map((t) => t.id) }),
      })
      if (res.ok) {
        const { suspended } = await res.json()
        toast.success(`Suspended ${suspended} stale tab${suspended !== 1 ? "s" : ""}`)
        onSuspended()
      } else {
        toast.error("Failed to suspend tabs")
      }
    } catch {
      toast.error("Failed to suspend tabs")
    } finally {
      setClosing(false)
      setOpen(false)
      setStaleTabs([])
    }
  }, [staleTabs, onSuspended])

  return (
    <>
      <Button variant="outline" onClick={check}>
        <HugeiconsIcon icon={SleepingIcon} className="size-4" />
        Suspend Stale
      </Button>

      <SuspendStaleDialog
        open={open}
        onOpenChange={setOpen}
        staleTabs={staleTabs}
        closing={closing}
        onConfirm={confirm}
      />
    </>
  )
}
