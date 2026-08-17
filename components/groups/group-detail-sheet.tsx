"use client"

import { useCallback, useEffect, useState } from "react"
import type { Tab, Group } from "@/types"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { FaviconImage } from "@/components/shared/favicon-image"
import { CategoryBadge } from "@/components/shared/category-badge"
import { Separator } from "@/components/ui/separator"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"

interface GroupDetailSheetProps {
  group: Group | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdated: () => void
}

export function GroupDetailSheet({ group, open, onOpenChange, onUpdated }: GroupDetailSheetProps) {
  // null means "not fetched yet", which is also what drives the loading state —
  // deriving it keeps the effect free of synchronous setState.
  const [loadedTabs, setLoadedTabs] = useState<Tab[] | null>(null)
  const isOpen = open && !!group
  const tabs = loadedTabs ?? []
  const loading = isOpen && loadedTabs === null

  // Drop the tabs on close so the next open doesn't flash the previous group's.
  const [wasOpen, setWasOpen] = useState(isOpen)
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen)
    if (!isOpen) setLoadedTabs(null)
  }

  useEffect(() => {
    if (!open || !group) return
    let cancelled = false
    fetch(`/api/groups/${group.id}/tabs`)
      .then((r) => r.json())
      .then((data: Tab[]) => {
        if (!cancelled) setLoadedTabs(data)
      })
      .catch(() => {
        if (!cancelled) setLoadedTabs([])
      })
    return () => {
      cancelled = true
    }
  }, [open, group])

  const handleRemoveTab = useCallback(
    async (tabId: string) => {
      if (!group) return
      await fetch(`/api/groups/${group.id}/tabs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tabIds: [tabId], action: "remove" }),
      })
      setLoadedTabs((prev) => (prev ?? []).filter((t) => t.id !== tabId))
      onUpdated()
    },
    [group, onUpdated],
  )

  if (!group) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-left">{group.name}</SheetTitle>
          {group.description && (
            <p className="text-sm text-muted-foreground">{group.description}</p>
          )}
        </SheetHeader>

        <div className="mt-6 px-6">
          <Separator />
          <h4 className="my-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Tabs ({tabs.length})
          </h4>

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          ) : tabs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No tabs in this group yet.
            </p>
          ) : (
            <div className="space-y-1">
              {tabs.map((tab) => (
                <div
                  key={tab.id}
                  className="group/tab flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-muted"
                >
                  <FaviconImage url={tab.faviconUrl} domain={tab.domain} size={20} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{tab.title || tab.url}</p>
                    <p className="truncate text-xs text-muted-foreground">{tab.domain}</p>
                  </div>
                  {tab.category && <CategoryBadge category={tab.category} />}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 opacity-0 group-hover/tab:opacity-100"
                    onClick={() => handleRemoveTab(tab.id)}
                    title="Remove from group"
                  >
                    <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
