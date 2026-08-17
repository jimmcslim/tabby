"use client"

import { useCallback, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { CloseDuplicatesDialog, type DuplicateInfo } from "@/components/dialogs/close-duplicates-dialog"
import { HugeiconsIcon } from "@hugeicons/react"
import { Copy01Icon } from "@hugeicons/core-free-icons"

/**
 * "Close Dupes" — owns the check, the confirm dialog and the close call. The
 * caller only says what to do once tabs have actually been closed.
 */
export function CloseDuplicatesAction({ onClosed }: { onClosed: () => void }) {
  const [open, setOpen] = useState(false)
  const [dupeInfo, setDupeInfo] = useState<DuplicateInfo | null>(null)
  const [closing, setClosing] = useState(false)

  const check = useCallback(async () => {
    const res = await fetch("/api/chrome/close-duplicates")
    if (res.ok) {
      setDupeInfo(await res.json())
      setOpen(true)
    }
  }, [])

  const confirm = useCallback(async () => {
    setClosing(true)
    try {
      const res = await fetch("/api/chrome/close-duplicates", { method: "POST" })
      if (res.ok) {
        const { closed } = await res.json()
        toast.success(`Closed ${closed} duplicate tab${closed !== 1 ? "s" : ""}`)
        onClosed()
      } else {
        toast.error("Failed to close duplicates")
      }
    } catch {
      toast.error("Failed to close duplicates")
    } finally {
      setClosing(false)
      setOpen(false)
      setDupeInfo(null)
    }
  }, [onClosed])

  return (
    <>
      <Button variant="outline" onClick={check}>
        <HugeiconsIcon icon={Copy01Icon} className="size-4" />
        Close Dupes
      </Button>

      <CloseDuplicatesDialog
        open={open}
        onOpenChange={setOpen}
        dupeInfo={dupeInfo}
        closing={closing}
        onConfirm={confirm}
      />
    </>
  )
}
