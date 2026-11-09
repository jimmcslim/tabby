"use client"

import { useCallback, useRef, useState } from "react"
import type { Tab } from "@/types"
import { useHistoryTabs } from "@/hooks/use-history-tabs"
import { LoadMoreSentinel } from "@/components/shared/load-more-sentinel"
import { Header } from "@/components/layout/header"
import { TabGrid } from "@/components/tabs/tab-grid"
import { TabDetailSheet } from "@/components/tabs/tab-detail-sheet"
import { EmptyState } from "@/components/shared/empty-state"
import { toast } from "sonner"

export default function HistoryPage() {
  const [search, setSearch] = useState("")
  const { tabs, loading, loadingMore, hasMore, loadMore, remove, replace } = useHistoryTabs(search)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [detailTab, setDetailTab] = useState<Tab | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const handleSelect = useCallback((id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (selected) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const handleReopen = useCallback(
    async (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId)
      if (!tab) return
      try {
        const res = await fetch("/api/chrome/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: tab.url }),
        })
        if (res.ok) {
          toast.success(`Reopened "${tab.title || tab.url}"`)
          remove(tabId)
        } else {
          toast.error("Failed to reopen tab")
        }
      } catch {
        toast.error("Failed to reopen tab")
      }
    },
    [tabs, remove],
  )

  return (
    <>
      <Header title="History" searchValue={search} onSearchChange={setSearch} />

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-8">
        {loading ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="animate-pulse overflow-hidden rounded-2xl bg-muted">
                <div className="aspect-[16/10]" />
                <div className="p-4 space-y-2">
                  <div className="h-4 w-3/4 rounded bg-muted-foreground/10" />
                  <div className="h-3 w-1/2 rounded bg-muted-foreground/10" />
                </div>
              </div>
            ))}
          </div>
        ) : tabs.length === 0 ? (
          <EmptyState
            title="No history yet"
            description="Tabs that you close will appear here."
          />
        ) : (
          <TabGrid
            tabs={tabs}
            selectedIds={selectedIds}
            onSelect={handleSelect}
            onFocus={handleReopen}
            onClose={() => {}}
            onClassify={() => {}}
            onTabClick={setDetailTab}
            onReopen={handleReopen}
          />
        )}

        {!loading && tabs.length > 0 && (
          <>
            <LoadMoreSentinel
              root={scrollRef}
              hasMore={hasMore}
              loading={loadingMore}
              onLoadMore={loadMore}
              itemCount={tabs.length}
            />
            <p className="py-6 text-center text-xs text-muted-foreground">
              {loadingMore ? "Loading more…" : hasMore ? "" : "End of history"}
            </p>
          </>
        )}
      </div>

      <TabDetailSheet
        tab={detailTab}
        open={!!detailTab}
        onOpenChange={(open) => !open && setDetailTab(null)}
        onFocus={handleReopen}
        onClose={() => {}}
        onTabUpdated={(t) => { setDetailTab(t); replace(t) }}
      />
    </>
  )
}
