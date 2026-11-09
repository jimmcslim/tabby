"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface CloseSelectedDialogProps {
  open: boolean
  tabCount: number
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

/** Confirm closing a large bulk selection (see BULK_CLOSE_CONFIRM_THRESHOLD). */
export function CloseSelectedDialog({ open, tabCount, onOpenChange, onConfirm }: CloseSelectedDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close Selected Tabs</DialogTitle>
        </DialogHeader>
        <p className="py-4 text-sm text-muted-foreground">
          Close <span className="font-medium text-foreground">{tabCount}</span> selected tab{tabCount !== 1 ? "s" : ""} in Chrome? This can&apos;t be undone from here.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm}>
            Close {tabCount} tab{tabCount !== 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
