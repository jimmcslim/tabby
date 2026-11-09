"use client"

import { useCallback, useDeferredValue, useMemo, useState } from "react"
import type { Tab } from "@/types"
import { useSyncContext } from "@/components/providers/sync-provider"
import { useTabs } from "@/hooks/use-tabs"
import { toast } from "sonner"
import { filterGroups, filterTabs } from "@/lib/tabs/search"
import { bulkCloseNeedsConfirm } from "@/lib/tabs/selection"
import { useTabGroups, useTabViewPrefs } from "@/hooks/use-tab-view-prefs"
import { useTabSelection } from "@/hooks/use-tab-selection"
import { useClassify } from "@/hooks/use-classify"
import { Header } from "@/components/layout/header"
import { DashboardToolbar } from "@/components/tabs/dashboard-toolbar"
import { TabGroupSection } from "@/components/tabs/tab-group-section"
import { TabDetailSheet } from "@/components/tabs/tab-detail-sheet"
import { ReaderSheet } from "@/components/tabs/reader-sheet"
import { BulkActionBar } from "@/components/tabs/bulk-action-bar"
import { CloseSelectedDialog } from "@/components/dialogs/close-selected-dialog"
import { CardZoomControl } from "@/components/tabs/card-zoom-control"
import { EmptyState } from "@/components/shared/empty-state"

export default function DashboardPage() {
  const { chromeStatus } = useSyncContext()
  const prefs = useTabViewPrefs()
  const {
    tabs,
    loading,
    windowNames,
    refresh,
    renameWindow,
    focusTab,
    closeTabs,
    forgetTabs,
    openTabInWindow,
    replaceTab,
    applyClassifications,
  } = useTabs()
  // Filter the loaded tabs in the browser. The deferred value lets React keep
  // the input responsive and render the (large) filtered grid at lower priority.
  const deferredSearch = useDeferredValue(prefs.search)
  const visibleTabs = useMemo(() => filterTabs(tabs, deferredSearch), [tabs, deferredSearch])
  const selection = useTabSelection()
  const { deselect, clear: clearSelection } = selection
  const classify = useClassify(visibleTabs, applyClassifications)
  const groups = useTabGroups(tabs, windowNames, prefs)
  // Group the full list so labels/order stay put while searching; filter inside
  // each group (dropping empty ones). Header counts use group.totalCount.
  const visibleGroups = useMemo(() => filterGroups(groups, deferredSearch), [groups, deferredSearch])

  const [detailTab, setDetailTab] = useState<Tab | null>(null)
  const [readerTab, setReaderTab] = useState<Tab | null>(null)

  const handleClose = useCallback(
    async (tabId: string) => {
      await closeTabs([tabId])
      deselect([tabId])
      setDetailTab((current) => (current?.id === tabId ? null : current))
    },
    // `deselect` is stable; depending on the whole `selection` object would
    // give every card a new onClose each render and defeat TabCard's memo.
    [closeTabs, deselect],
  )

  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)

  const closeSelected = useCallback(async () => {
    const ids = Array.from(selection.selectedIds)
    await closeTabs(ids)
    clearSelection()
    toast.success(`Closed ${ids.length} tab${ids.length !== 1 ? "s" : ""}`)
  }, [closeTabs, clearSelection, selection.selectedIds])

  // Big selections get a confirmation; small ones close immediately.
  const handleBulkClose = useCallback(async () => {
    if (bulkCloseNeedsConfirm(selection.count)) setConfirmCloseOpen(true)
    else await closeSelected()
  }, [selection.count, closeSelected])

  const handleConfirmBulkClose = useCallback(async () => {
    setConfirmCloseOpen(false)
    await closeSelected()
  }, [closeSelected])

  // Changing the search clears the selection, so it can never hold tabs the
  // filter has hidden (and a later bulk close would silently take with it).
  const handleSearchChange = useCallback(
    (value: string) => {
      prefs.setSearch(value)
      clearSelection()
    },
    [prefs, clearSelection],
  )

  const filtered = deferredSearch !== ""
  const handleSelectAllMatching = useCallback(
    () => selection.selectMany(visibleTabs.map((t) => t.id)),
    [selection, visibleTabs],
  )

  const handleGroupClosed = useCallback(
    (closedIds: string[]) => {
      forgetTabs(closedIds)
      selection.deselect(closedIds)
    },
    [forgetTabs, selection],
  )

  const handleTabUpdated = useCallback(
    (updated: Tab) => {
      replaceTab(updated)
      setDetailTab(updated)
    },
    [replaceTab],
  )

  const notConnected = chromeStatus && !chromeStatus.connected

  return (
    <>
      <Header title="Dashboard" searchValue={prefs.search} onSearchChange={handleSearchChange}>
        <DashboardToolbar
          hasTabs={tabs.length > 0}
          prefs={prefs}
          classify={classify}
          onHygieneAction={refresh}
          matchCount={filtered ? visibleTabs.length : 0}
          onSelectAllMatching={handleSelectAllMatching}
        />
      </Header>

      {/* Top padding lives inside the scroll content, not on the container —
          padding on the scroll container offsets the sticky pin line and lets
          cards peek out above the pinned group headers. */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {notConnected ? (
          <EmptyState
            title="Chrome not connected"
            description="Install the Tabby Connector extension — it pushes your tabs here and needs no special Chrome flags."
            action={
              <div className="space-y-2 text-left">
                <div className="rounded-lg bg-muted px-4 py-3 space-y-2">
                  <p className="text-xs font-medium">1. Open <code className="text-xs">chrome://extensions</code> and enable Developer mode.</p>
                  <p className="text-xs font-medium">2. Click &ldquo;Load unpacked&rdquo; and select this repo&apos;s <code className="text-xs">extension/</code> folder.</p>
                  <p className="text-xs font-medium">3. Tabby connects automatically within a few seconds.</p>
                </div>
              </div>
            }
          />
        ) : loading ? (
          <div className="grid grid-cols-1 gap-5 pt-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
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
        ) : visibleTabs.length === 0 ? (
          <EmptyState
            title={deferredSearch ? "No tabs match your search" : "No open tabs found"}
            description={
              deferredSearch
                ? "Try a different search term."
                : "Open some tabs in Chrome and they'll appear here automatically."
            }
          />
        ) : (
          <div className="space-y-8 pt-8">
            {visibleGroups.map((group) => (
              <TabGroupSection
                key={group.key}
                group={group}
                filtered={filtered}
                prefs={prefs}
                selection={selection}
                onRenameWindow={renameWindow}
                onAddTab={
                  prefs.groupBy === "window" && group.key !== "__unknown"
                    ? openTabInWindow
                    : undefined
                }
                onFocus={focusTab}
                onCloseTab={handleClose}
                onClassify={classify.classifyTab}
                onTabClick={setDetailTab}
                onReadArticle={setReaderTab}
                onGroupClosed={handleGroupClosed}
              />
            ))}
          </div>
        )}
      </div>

      <TabDetailSheet
        tab={detailTab}
        open={!!detailTab}
        onOpenChange={(open) => !open && setDetailTab(null)}
        onFocus={focusTab}
        onClose={handleClose}
        onTabUpdated={handleTabUpdated}
        onReadArticle={(tab) => {
          setDetailTab(null)
          setReaderTab(tab)
        }}
      />

      <ReaderSheet
        tab={readerTab}
        open={!!readerTab}
        onOpenChange={(open) => !open && setReaderTab(null)}
      />

      <CardZoomControl
        visible={prefs.view === "card" && !loading && tabs.length > 0}
        value={prefs.gridCols}
        onChange={prefs.setGridCols}
      />

      <BulkActionBar
        count={selection.count}
        onClose={handleBulkClose}
        onClassify={() => classify.classifyTabs(Array.from(selection.selectedIds))}
        onDeselect={selection.clear}
        classifying={classify.bulkClassifying}
      />

      <CloseSelectedDialog
        open={confirmCloseOpen}
        tabCount={selection.count}
        onOpenChange={setConfirmCloseOpen}
        onConfirm={handleConfirmBulkClose}
      />
    </>
  )
}
