"use client"

import type { Tab } from "@/types"
import { FaviconImage } from "@/components/shared/favicon-image"
import { Checkbox } from "@/components/ui/checkbox"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  CursorPointer01Icon,
  Cancel01Icon,
  SparklesIcon,
  ArrowReloadHorizontalIcon,
  GlassesIcon,
} from "@hugeicons/core-free-icons"
import { isArticleTab } from "@/components/tabs/reader-sheet"

interface TabListProps {
  tabs: Tab[]
  selectedIds: Set<string>
  onSelect: (id: string, selected: boolean) => void
  onFocus: (tabId: string) => void
  onClose: (tabId: string) => void
  onClassify: (tabId: string) => void
  onTabClick: (tab: Tab) => void
  onReopen?: (tabId: string) => void
  onReadArticle?: (tab: Tab) => void
}

function ActionButton({
  icon,
  title,
  destructive,
  onClick,
}: {
  icon: typeof Cancel01Icon
  title: string
  destructive?: boolean
  onClick: () => void
}) {
  return (
    <button
      className={`inline-flex items-center rounded-lg p-1.5 text-muted-foreground transition-colors ${
        destructive ? "hover:bg-destructive/10 hover:text-destructive" : "hover:bg-muted hover:text-foreground"
      }`}
      onClick={onClick}
      title={title}
    >
      <HugeiconsIcon icon={icon} className="size-3.5" />
    </button>
  )
}

export function TabList({ tabs, selectedIds, onSelect, onFocus, onClose, onClassify, onTabClick, onReopen, onReadArticle }: TabListProps) {
  return (
    <div className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60 bg-card">
      {tabs.map((tab) => {
        const isSelected = selectedIds.has(tab.id)
        return (
          <div
            key={tab.id}
            className={`group flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors ${
              isSelected ? "bg-primary/5" : "hover:bg-muted/50"
            }`}
            onClick={() => onTabClick(tab)}
          >
            <div onClick={(e) => e.stopPropagation()}>
              <div className={`transition-opacity ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={(checked) => onSelect(tab.id, checked as boolean)}
                />
              </div>
            </div>

            <FaviconImage url={tab.faviconUrl} domain={tab.domain} size={20} className="shrink-0" />

            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {tab.title || tab.url}
            </span>

            <div
              className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={(e) => e.stopPropagation()}
            >
              {isArticleTab(tab) && onReadArticle && (
                <ActionButton icon={GlassesIcon} title="Read article" onClick={() => onReadArticle(tab)} />
              )}
              {tab.status === "closed" && onReopen && (
                <ActionButton icon={ArrowReloadHorizontalIcon} title="Reopen in Chrome" onClick={() => onReopen(tab.id)} />
              )}
              {!tab.category && (
                <ActionButton icon={SparklesIcon} title="Classify with AI" onClick={() => onClassify(tab.id)} />
              )}
              {tab.status === "open" && (
                <ActionButton icon={CursorPointer01Icon} title="Focus in Chrome" onClick={() => onFocus(tab.id)} />
              )}
              {tab.status === "open" && (
                <ActionButton icon={Cancel01Icon} title="Close tab" destructive onClick={() => onClose(tab.id)} />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
