"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Tab } from "@/types"
import { type GroupBy, type SortBy, type SortDir, type TabGroup, groupTabs, sortTabs } from "@/lib/tabs/grouping"
import { useSyncContext } from "@/components/providers/sync-provider"
import { Header } from "@/components/layout/header"
import { TabGrid } from "@/components/tabs/tab-grid"
import { TabList } from "@/components/tabs/tab-list"
import { TabDetailSheet } from "@/components/tabs/tab-detail-sheet"
import { ReaderSheet } from "@/components/tabs/reader-sheet"
import { BulkActionBar } from "@/components/tabs/bulk-action-bar"
import { EditableGroupHeader } from "@/components/tabs/group-header"
import { CardZoomControl } from "@/components/tabs/card-zoom-control"
import { EmptyState } from "@/components/shared/empty-state"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { CloseDuplicatesDialog, type DuplicateInfo } from "@/components/dialogs/close-duplicates-dialog"
import { SuspendStaleDialog } from "@/components/dialogs/suspend-stale-dialog"
import { CloseGroupDialog } from "@/components/dialogs/close-group-dialog"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  SparklesIcon,
  Copy01Icon,
  SleepingIcon,
  Cancel01Icon,
  GridViewIcon,
  ListViewIcon,
  ArrowDown01Icon,
  ArrowUpDoubleIcon,
  ArrowDownDoubleIcon,
  SortByUp01Icon,
  SortByDown01Icon,
} from "@hugeicons/core-free-icons"
import { toast } from "sonner"

export default function DashboardPage() {
  const { lastSync, chromeStatus } = useSyncContext()
  const [tabs, setTabs] = useState<Tab[]>([])
  const [search, setSearch] = useState("")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [detailTab, setDetailTab] = useState<Tab | null>(null)
  const [groupBy, setGroupBy] = useState<GroupBy>("window")
  const [sortBy, setSortBy] = useState<SortBy>("browser")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [view, setView] = useState<"card" | "list">("card")
  // Cards per row in card view: 4 (max zoom in, default) to 16 (max zoom out)
  const [gridCols, setGridCols] = useState(4)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const groupRefs = useRef(new Map<string, HTMLDivElement>())
  const [windowNames, setWindowNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [classifyingAll, setClassifyingAll] = useState(false)
  const [bulkClassifying, setBulkClassifying] = useState(false)
  const [dupeDialogOpen, setDupeDialogOpen] = useState(false)
  const [dupeInfo, setDupeInfo] = useState<DuplicateInfo | null>(null)
  const [closingDupes, setClosingDupes] = useState(false)
  const [staleDialogOpen, setStaleDialogOpen] = useState(false)
  const [staleTabs, setStaleTabs] = useState<Tab[]>([])
  const [closingStale, setClosingStale] = useState(false)
  const [closeGroupConfirm, setCloseGroupConfirm] = useState<TabGroup | null>(null)
  const [readerTab, setReaderTab] = useState<Tab | null>(null)

  const fetchTabs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ status: "open" })
      if (search) params.set("search", search)
      const res = await fetch(`/api/tabs?${params}`)
      if (res.ok) setTabs(await res.json())
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    fetchTabs()
  }, [fetchTabs, lastSync])

  // Fetch window names
  useEffect(() => {
    fetch("/api/window-names")
      .then((r) => r.json())
      .then(setWindowNames)
      .catch(() => {})
  }, [])

  const handleRenameWindow = useCallback(async (windowId: string, name: string) => {
    setWindowNames((prev) => ({ ...prev, [windowId]: name }))
    await fetch("/api/window-names", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ windowId, name }),
    })
  }, [])

  // Group keys aren't stable across grouping modes (e.g. a window id could
  // collide with a domain string), so collapsed state doesn't carry over.
  useEffect(() => {
    setCollapsedGroups(new Set())
  }, [groupBy])

  const toggleGroupCollapsed = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const scrollGroupIntoView = useCallback((key: string, edge: "start" | "end") => {
    groupRefs.current.get(key)?.scrollIntoView({ behavior: "smooth", block: edge })
  }, [])

  const handleSelect = useCallback((id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (selected) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const handleFocus = useCallback(async (tabId: string) => {
    await fetch("/api/chrome/focus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tabId }),
    })
  }, [])

  const handleClose = useCallback(
    async (tabId: string) => {
      await fetch("/api/chrome/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tabId }),
      })
      setTabs((prev) => prev.filter((t) => t.id !== tabId))
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.delete(tabId)
        return next
      })
      if (detailTab?.id === tabId) setDetailTab(null)
    },
    [detailTab],
  )

  const handleBulkClose = useCallback(async () => {
    const ids = Array.from(selectedIds)
    await Promise.all(
      ids.map((tabId) =>
        fetch("/api/chrome/close", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tabId }),
        }),
      ),
    )
    setTabs((prev) => prev.filter((t) => !selectedIds.has(t.id)))
    setSelectedIds(new Set())
  }, [selectedIds])

  // AI: classify a single tab
  const handleClassify = useCallback(async (tabId: string) => {
    const res = await fetch("/api/ai/classify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tabIds: [tabId] }),
    })
    if (res.ok) {
      const data = await res.json()
      if (data.results?.[0]) {
        setTabs((prev) =>
          prev.map((t) => (t.id === data.results[0].id ? { ...t, category: data.results[0].category, isArticle: data.results[0].isArticle } : t)),
        )
      }
    }
  }, [])

  // AI: classify selected tabs
  const handleBulkClassify = useCallback(async () => {
    setBulkClassifying(true)
    try {
      const res = await fetch("/api/ai/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tabIds: Array.from(selectedIds) }),
      })
      if (res.ok) {
        const data = await res.json()
        const updates = new Map<string, { category: string; isArticle: boolean }>(data.results?.map((r: any) => [r.id, { category: r.category, isArticle: r.isArticle }]) || [])
        setTabs((prev) => prev.map((t) => {
          const u = updates.get(t.id)
          return u ? { ...t, category: u.category, isArticle: u.isArticle } : t
        }))
      }
    } finally {
      setBulkClassifying(false)
    }
  }, [selectedIds])

  // AI: classify all unclassified tabs
  const handleClassifyAll = useCallback(async () => {
    const unclassified = tabs.filter((t) => !t.category)
    if (unclassified.length === 0) return
    setClassifyingAll(true)
    try {
      const res = await fetch("/api/ai/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tabIds: unclassified.map((t) => t.id) }),
      })
      if (res.ok) {
        const data = await res.json()
        const updates = new Map<string, { category: string; isArticle: boolean }>(data.results?.map((r: any) => [r.id, { category: r.category, isArticle: r.isArticle }]) || [])
        setTabs((prev) => prev.map((t) => {
          const u = updates.get(t.id)
          return u ? { ...t, category: u.category, isArticle: u.isArticle } : t
        }))
      }
    } finally {
      setClassifyingAll(false)
    }
  }, [tabs])

  // Update tab in local state (from detail sheet AI actions)
  const handleTabUpdated = useCallback((updated: Tab) => {
    setTabs((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
    setDetailTab(updated)
  }, [])

  const handleAddTab = useCallback(async (windowId: number) => {
    const res = await fetch("/api/chrome/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ windowId }),
    })
    if (res.ok) {
      fetchTabs()
    } else {
      toast.error("Failed to open tab")
    }
  }, [fetchTabs])

  const handleCheckDuplicates = useCallback(async () => {
    const res = await fetch("/api/chrome/close-duplicates")
    if (res.ok) {
      setDupeInfo(await res.json())
      setDupeDialogOpen(true)
    }
  }, [])

  const handleCloseDuplicates = useCallback(async () => {
    setClosingDupes(true)
    try {
      const res = await fetch("/api/chrome/close-duplicates", { method: "POST" })
      if (res.ok) {
        const { closed } = await res.json()
        toast.success(`Closed ${closed} duplicate tab${closed !== 1 ? "s" : ""}`)
        fetchTabs()
      } else {
        toast.error("Failed to close duplicates")
      }
    } catch {
      toast.error("Failed to close duplicates")
    } finally {
      setClosingDupes(false)
      setDupeDialogOpen(false)
      setDupeInfo(null)
    }
  }, [fetchTabs])

  const handleCheckStale = useCallback(async () => {
    const res = await fetch("/api/tabs/stale?hours=24")
    if (res.ok) {
      const data = await res.json()
      setStaleTabs(data.tabs)
      setStaleDialogOpen(true)
    }
  }, [])

  const handleCloseStale = useCallback(async () => {
    setClosingStale(true)
    try {
      const res = await fetch("/api/tabs/stale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tabIds: staleTabs.map((t) => t.id) }),
      })
      if (res.ok) {
        const { suspended } = await res.json()
        toast.success(`Suspended ${suspended} stale tab${suspended !== 1 ? "s" : ""}`)
        fetchTabs()
      } else {
        toast.error("Failed to suspend tabs")
      }
    } catch {
      toast.error("Failed to suspend tabs")
    } finally {
      setClosingStale(false)
      setStaleDialogOpen(false)
      setStaleTabs([])
    }
  }, [staleTabs, fetchTabs])

  const handleConfirmCloseGroup = useCallback(async () => {
    if (!closeGroupConfirm) return
    const openTabs = closeGroupConfirm.tabs.filter((t) => t.status === "open")
    if (openTabs.length === 0) return
    await Promise.all(
      openTabs.map((t) =>
        fetch("/api/chrome/close", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tabId: t.id }),
        })
      ),
    )
    const closedIds = new Set(openTabs.map((t) => t.id))
    setTabs((prev) => prev.filter((t) => !closedIds.has(t.id)))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const id of closedIds) next.delete(id)
      return next
    })
    toast.success(`Closed ${openTabs.length} tab${openTabs.length !== 1 ? "s" : ""}`)
    setCloseGroupConfirm(null)
  }, [closeGroupConfirm])

  const groups = useMemo(
    () =>
      groupTabs(tabs, groupBy, windowNames).map((g) => ({
        ...g,
        tabs: sortTabs(g.tabs, sortBy, sortDir),
      })),
    [tabs, groupBy, windowNames, sortBy, sortDir],
  )
  const notConnected = chromeStatus && !chromeStatus.connected
  const hasUnclassified = tabs.some((t) => !t.category)

  return (
    <>
      <Header title="Dashboard" searchValue={search} onSearchChange={setSearch}>
        {tabs.length > 0 && (
          <ToggleGroup
            variant="outline"
            size="sm"
            value={[view]}
            onValueChange={(value) => {
              const next = value[0] as "card" | "list" | undefined
              if (next) setView(next)
            }}
          >
            <ToggleGroupItem value="card" aria-label="Card view" title="Card view">
              <HugeiconsIcon icon={GridViewIcon} className="size-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="List view" title="List view">
              <HugeiconsIcon icon={ListViewIcon} className="size-4" />
            </ToggleGroupItem>
          </ToggleGroup>
        )}
        {tabs.length > 0 && (
          <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
            <SelectTrigger size="sm">
              <span className="text-muted-foreground">Group by:</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end" alignItemWithTrigger={false}>
              <SelectItem value="window">Window</SelectItem>
              <SelectItem value="category">Category</SelectItem>
              <SelectItem value="domain">Domain</SelectItem>
              <SelectItem value="none">None</SelectItem>
            </SelectContent>
          </Select>
        )}
        {tabs.length > 0 && (
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
            <SelectTrigger size="sm">
              <span className="text-muted-foreground">Sort by:</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end" alignItemWithTrigger={false}>
              <SelectItem value="browser">Browser order</SelectItem>
              <SelectItem value="lastAccessed">Last active</SelectItem>
              <SelectItem value="dateAdded">Date added</SelectItem>
              <SelectItem value="title">Title</SelectItem>
              <SelectItem value="domain">Domain</SelectItem>
            </SelectContent>
          </Select>
        )}
        {tabs.length > 0 && (
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            title={sortDir === "asc" ? "Sort ascending" : "Sort descending"}
            aria-label={sortDir === "asc" ? "Sort ascending" : "Sort descending"}
          >
            <HugeiconsIcon icon={sortDir === "asc" ? SortByUp01Icon : SortByDown01Icon} className="size-4" />
          </Button>
        )}
        {tabs.length > 0 && (
          <Button variant="outline" onClick={handleCheckStale}>
            <HugeiconsIcon icon={SleepingIcon} className="size-4" />
            Suspend Stale
          </Button>
        )}
        {tabs.length > 0 && (
          <Button variant="outline" onClick={handleCheckDuplicates}>
            <HugeiconsIcon icon={Copy01Icon} className="size-4" />
            Close Dupes
          </Button>
        )}
        {tabs.length > 0 && hasUnclassified && (
          <Button variant="outline" onClick={handleClassifyAll} disabled={classifyingAll}>
            <HugeiconsIcon icon={SparklesIcon} className="size-4" />
            {classifyingAll ? "Classifying..." : "Classify All"}
          </Button>
        )}
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
        ) : tabs.length === 0 ? (
          <EmptyState
            title={search ? "No tabs match your search" : "No open tabs found"}
            description={
              search
                ? "Try a different search term."
                : "Open some tabs in Chrome and they'll appear here automatically."
            }
          />
        ) : (
          <div className="space-y-8 pt-8">
            {groups.map((group) => (
              <Collapsible
                key={group.key}
                open={!collapsedGroups.has(group.key)}
                onOpenChange={() => toggleGroupCollapsed(group.key)}
                render={
                  <div
                    className="group/section"
                    ref={(el) => {
                      if (el) groupRefs.current.set(group.key, el)
                      else groupRefs.current.delete(group.key)
                    }}
                  />
                }
              >
                {group.label && (
                  <div className="sticky top-0 z-10 -mx-2 mb-2 flex items-center gap-3 rounded-b-lg bg-background/80 px-2 py-2 backdrop-blur-md">
                    <CollapsibleTrigger
                      className="shrink-0 rounded-lg p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                      title={collapsedGroups.has(group.key) ? "Expand group" : "Collapse group"}
                      aria-label={collapsedGroups.has(group.key) ? `Expand ${group.label}` : `Collapse ${group.label}`}
                    >
                      <HugeiconsIcon
                        icon={ArrowDown01Icon}
                        className={`size-3.5 transition-transform ${collapsedGroups.has(group.key) ? "-rotate-90" : ""}`}
                      />
                    </CollapsibleTrigger>
                    {group.editable ? (
                      <EditableGroupHeader group={group} onRename={handleRenameWindow} />
                    ) : (
                      <h2 className="text-sm font-medium capitalize text-muted-foreground">
                        {group.label}
                      </h2>
                    )}
                    <span className="text-xs text-muted-foreground/60">
                      {group.tabs.length} {group.tabs.length === 1 ? "tab" : "tabs"}
                    </span>
                    <div className="h-px flex-1 bg-border/50" />
                    <div className="flex items-center gap-1 opacity-0 transition-all group-hover/section:opacity-100">
                      <button
                        className="rounded-lg p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                        onClick={() => scrollGroupIntoView(group.key, "start")}
                        title={`Scroll to start of ${group.label}`}
                        aria-label={`Scroll to start of ${group.label}`}
                      >
                        <HugeiconsIcon icon={ArrowUpDoubleIcon} className="size-3.5" />
                      </button>
                      <button
                        className="rounded-lg p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                        onClick={() => scrollGroupIntoView(group.key, "end")}
                        title={`Scroll to end of ${group.label}`}
                        aria-label={`Scroll to end of ${group.label}`}
                      >
                        <HugeiconsIcon icon={ArrowDownDoubleIcon} className="size-3.5" />
                      </button>
                      <button
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setCloseGroupConfirm(group)}
                        title={`Close all tabs in ${group.label}`}
                      >
                        <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
                        Close all
                      </button>
                    </div>
                  </div>
                )}
                <CollapsibleContent className="overflow-hidden data-open:animate-accordion-down data-closed:animate-accordion-up">
                  {view === "card" ? (
                    <TabGrid
                      tabs={group.tabs}
                      columns={gridCols}
                      onAddTab={
                        groupBy === "window" && group.key !== "__unknown"
                          ? () => handleAddTab(Number(group.key))
                          : undefined
                      }
                      selectedIds={selectedIds}
                      onSelect={handleSelect}
                      onFocus={handleFocus}
                      onClose={handleClose}
                      onClassify={handleClassify}
                      onTabClick={setDetailTab}
                      onReadArticle={setReaderTab}
                    />
                  ) : (
                    <TabList
                      tabs={group.tabs}
                      selectedIds={selectedIds}
                      onSelect={handleSelect}
                      onFocus={handleFocus}
                      onClose={handleClose}
                      onClassify={handleClassify}
                      onTabClick={setDetailTab}
                      onReadArticle={setReaderTab}
                    />
                  )}
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        )}
      </div>

      <TabDetailSheet
        tab={detailTab}
        open={!!detailTab}
        onOpenChange={(open) => !open && setDetailTab(null)}
        onFocus={handleFocus}
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
        visible={view === "card" && !loading && tabs.length > 0}
        value={gridCols}
        onChange={setGridCols}
      />

      <BulkActionBar
        count={selectedIds.size}
        onClose={handleBulkClose}
        onClassify={handleBulkClassify}
        onDeselect={() => setSelectedIds(new Set())}
        classifying={bulkClassifying}
      />

      <CloseDuplicatesDialog
        open={dupeDialogOpen}
        onOpenChange={setDupeDialogOpen}
        dupeInfo={dupeInfo}
        closing={closingDupes}
        onConfirm={handleCloseDuplicates}
      />

      <SuspendStaleDialog
        open={staleDialogOpen}
        onOpenChange={setStaleDialogOpen}
        staleTabs={staleTabs}
        closing={closingStale}
        onConfirm={handleCloseStale}
      />

      <CloseGroupDialog
        open={!!closeGroupConfirm}
        groupLabel={closeGroupConfirm?.label ?? ""}
        tabCount={closeGroupConfirm?.tabs.length ?? 0}
        onOpenChange={(o) => !o && setCloseGroupConfirm(null)}
        onConfirm={handleConfirmCloseGroup}
      />
    </>
  )
}
