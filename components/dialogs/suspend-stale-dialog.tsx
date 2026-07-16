"use client"

import type { Tab } from "@/types"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { FaviconImage } from "@/components/shared/favicon-image"

interface SuspendStaleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  staleTabs: Tab[]
  closing: boolean
  onConfirm: () => void
}

export function SuspendStaleDialog({ open, onOpenChange, staleTabs, closing, onConfirm }: SuspendStaleDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Suspend Stale Tabs</DialogTitle>
        </DialogHeader>
        {staleTabs.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No stale tabs found. All tabs have been active in the last 24 hours.</p>
        ) : (
          <div className="py-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Found <span className="font-medium text-foreground">{staleTabs.length}</span> tab{staleTabs.length !== 1 ? "s" : ""} inactive for over 24 hours.
            </p>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {staleTabs.map((t) => (
                <div key={t.id} className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs">
                  <FaviconImage url={t.faviconUrl} domain={t.domain} size={14} />
                  <span className="min-w-0 truncate">{t.title || t.url}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground">{t.domain}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {staleTabs.length > 0 && (
            <Button variant="destructive" onClick={onConfirm} disabled={closing}>
              {closing ? "Suspending..." : `Suspend ${staleTabs.length} tab${staleTabs.length !== 1 ? "s" : ""}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
