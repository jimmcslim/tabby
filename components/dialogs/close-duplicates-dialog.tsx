"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

export interface DuplicateInfo {
  duplicates: { url: string; count: number }[]
  totalToClose: number
}

interface CloseDuplicatesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  dupeInfo: DuplicateInfo | null
  closing: boolean
  onConfirm: () => void
}

export function CloseDuplicatesDialog({ open, onOpenChange, dupeInfo, closing, onConfirm }: CloseDuplicatesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close Duplicate Tabs</DialogTitle>
        </DialogHeader>
        {dupeInfo && dupeInfo.totalToClose === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No duplicate tabs found.</p>
        ) : dupeInfo ? (
          <div className="py-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Found <span className="font-medium text-foreground">{dupeInfo.totalToClose}</span> duplicate{" "}
              tab{dupeInfo.totalToClose !== 1 ? "s" : ""} across{" "}
              <span className="font-medium text-foreground">{dupeInfo.duplicates.length}</span> URL{dupeInfo.duplicates.length !== 1 ? "s" : ""}.
            </p>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {dupeInfo.duplicates.map((d) => (
                <div key={d.url} className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-xs">
                  <span className="min-w-0 truncate text-muted-foreground">{d.url}</span>
                  <span className="ml-2 shrink-0 font-medium">{d.count}x</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {dupeInfo && dupeInfo.totalToClose > 0 && (
            <Button variant="destructive" onClick={onConfirm} disabled={closing}>
              {closing ? "Closing..." : `Close ${dupeInfo.totalToClose} duplicate${dupeInfo.totalToClose !== 1 ? "s" : ""}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
