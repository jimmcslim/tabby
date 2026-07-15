"use client"

import type { Tab } from "@/types"
import { TabCard } from "./tab-card"

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
}

export function TabGrid({ tabs, selectedIds, onSelect, onFocus, onClose, onClassify, onTabClick, onReopen, onReadArticle, columns }: TabGridProps) {
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
    </div>
  )
}
