"use client"

import { useCallback, useState } from "react"
import { toast } from "sonner"
import { CloseGroupDialog } from "@/components/dialogs/close-group-dialog"
import type { TabGroup } from "@/lib/tabs/grouping"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"

/**
 * A group header's "Close all" — owns the confirm dialog and the close calls,
 * then hands the caller the ids it closed so the list and selection can drop
 * them without a refetch.
 */
export function CloseGroupAction({
  group,
  onClosed,
}: {
  group: TabGroup
  onClosed: (closedIds: string[]) => void
}) {
  const [open, setOpen] = useState(false)

  const confirm = useCallback(async () => {
    const openTabs = group.tabs.filter((t) => t.status === "open")
    if (openTabs.length === 0) return
    await Promise.all(
      openTabs.map((t) =>
        fetch("/api/chrome/close", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tabId: t.id }),
        }),
      ),
    )
    onClosed(openTabs.map((t) => t.id))
    toast.success(`Closed ${openTabs.length} tab${openTabs.length !== 1 ? "s" : ""}`)
    setOpen(false)
  }, [group, onClosed])

  return (
    <>
      <button
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
        onClick={() => setOpen(true)}
        title={`Close all tabs in ${group.label}`}
      >
        <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
        Close all
      </button>

      <CloseGroupDialog
        open={open}
        groupLabel={group.label}
        tabCount={group.tabs.length}
        onOpenChange={setOpen}
        onConfirm={confirm}
      />
    </>
  )
}
