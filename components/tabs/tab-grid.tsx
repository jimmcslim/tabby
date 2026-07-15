"use client"

import type { Tab } from "@/types"
import { TabCard } from "./tab-card"
import { HugeiconsIcon } from "@hugeicons/react"
import { PlusSignIcon } from "@hugeicons/core-free-icons"

interface TabGridProps {
  tabs: Tab[]
  selectedIds: Set<string>
  onSelect: (id: string, selected: boolean) => void
  onFocus: (tabId: string) => void
  onClose: (tabId: string) => void
  onClassify: (tabId: string) => void
  onTabClick: (tab: Tab) => void
  onReopen?: (tabId: string) => void
  onReadArticle?: (tab: Tab) => void
  /** Fixed column count (zoom); omit for the default responsive grid */
  columns?: number
  /** When set, renders a trailing empty card whose + button opens a new tab */
  onAddTab?: () => void
}

export function TabGrid({ tabs, selectedIds, onSelect, onFocus, onClose, onClassify, onTabClick, onReopen, onReadArticle, columns, onAddTab }: TabGridProps) {
  return (
    <div
      className={
        columns
          ? `grid ${columns > 8 ? "gap-3" : "gap-5"}`
          : "grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
      }
      style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {tabs.map((tab) => (
        <TabCard
          key={tab.id}
          tab={tab}
          isSelected={selectedIds.has(tab.id)}
          onSelect={onSelect}
          onFocus={onFocus}
          onClose={onClose}
          onClassify={onClassify}
          onClick={onTabClick}
          onReopen={onReopen}
          onReadArticle={onReadArticle}
        />
      ))}
      {onAddTab && (
        <button
          className="flex min-h-32 items-center justify-center rounded-2xl border border-dashed border-border/60 text-muted-foreground/60 transition-colors hover:border-border hover:bg-muted/30 hover:text-foreground"
          onClick={onAddTab}
          title="Open a new tab in this window"
        >
          <HugeiconsIcon icon={PlusSignIcon} className="size-8" />
        </button>
      )}
    </div>
  )
}
