"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface CloseGroupDialogProps {
  open: boolean
  groupLabel: string
  tabCount: number
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export function CloseGroupDialog({ open, groupLabel, tabCount, onOpenChange, onConfirm }: CloseGroupDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close All Tabs</DialogTitle>
        </DialogHeader>
        <p className="py-4 text-sm text-muted-foreground">
          Close all <span className="font-medium text-foreground">{tabCount}</span> tab{tabCount !== 1 ? "s" : ""} in &ldquo;{groupLabel}&rdquo;?
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
