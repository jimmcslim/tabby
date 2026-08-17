"use client"

import type { Tab } from "@/types"
import type { TabGroup } from "@/lib/tabs/grouping"
import type { UseTabViewPrefs } from "@/hooks/use-tab-view-prefs"
import type { UseTabSelection } from "@/hooks/use-tab-selection"
import { TabGrid } from "@/components/tabs/tab-grid"
import { TabList } from "@/components/tabs/tab-list"
import { EditableGroupHeader } from "@/components/tabs/group-header"
import { CloseGroupAction } from "@/components/dialogs/close-group-action"
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  ArrowUpDoubleIcon,
  ArrowDownDoubleIcon,
} from "@hugeicons/core-free-icons"

interface TabGroupSectionProps {
  group: TabGroup
  prefs: UseTabViewPrefs
  selection: UseTabSelection
  onRenameWindow: (windowId: string, name: string) => void
  onAddTab: ((windowId: number) => void) | undefined
  onFocus: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onClassify: (tabId: string) => void
  onTabClick: (tab: Tab) => void
  onReadArticle: (tab: Tab) => void
  onGroupClosed: (closedIds: string[]) => void
}

/** One collapsible group on the dashboard: its sticky header and its tabs. */
export function TabGroupSection({
  group,
  prefs,
  selection,
  onRenameWindow,
  onAddTab,
  onFocus,
  onCloseTab,
  onClassify,
  onTabClick,
  onReadArticle,
  onGroupClosed,
}: TabGroupSectionProps) {
  const collapsed = prefs.isCollapsed(group.key)

  return (
    <Collapsible
      open={!collapsed}
      onOpenChange={() => prefs.toggleCollapsed(group.key)}
      render={<div className="group/section" ref={prefs.registerGroup(group.key)} />}
    >
      {group.label && (
        <div className="sticky top-0 z-10 -mx-2 mb-2 flex items-center gap-3 rounded-b-lg bg-background/80 px-2 py-2 backdrop-blur-md">
          <CollapsibleTrigger
            className="shrink-0 rounded-lg p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
            title={collapsed ? "Expand group" : "Collapse group"}
            aria-label={collapsed ? `Expand ${group.label}` : `Collapse ${group.label}`}
          >
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              className={`size-3.5 transition-transform ${collapsed ? "-rotate-90" : ""}`}
            />
          </CollapsibleTrigger>
          {group.editable ? (
            <EditableGroupHeader group={group} onRename={onRenameWindow} />
          ) : (
            <h2 className="text-sm font-medium capitalize text-muted-foreground">{group.label}</h2>
          )}
          <span className="text-xs text-muted-foreground/60">
            {group.tabs.length} {group.tabs.length === 1 ? "tab" : "tabs"}
          </span>
          <div className="h-px flex-1 bg-border/50" />
          <div className="flex items-center gap-1 opacity-0 transition-all group-hover/section:opacity-100">
            <button
              className="rounded-lg p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
              onClick={() => prefs.scrollGroupIntoView(group.key, "start")}
              title={`Scroll to start of ${group.label}`}
              aria-label={`Scroll to start of ${group.label}`}
            >
              <HugeiconsIcon icon={ArrowUpDoubleIcon} className="size-3.5" />
            </button>
            <button
              className="rounded-lg p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
              onClick={() => prefs.scrollGroupIntoView(group.key, "end")}
              title={`Scroll to end of ${group.label}`}
              aria-label={`Scroll to end of ${group.label}`}
            >
              <HugeiconsIcon icon={ArrowDownDoubleIcon} className="size-3.5" />
            </button>
            <CloseGroupAction group={group} onClosed={onGroupClosed} />
          </div>
        </div>
      )}
      <CollapsibleContent className="overflow-hidden data-open:animate-accordion-down data-closed:animate-accordion-up">
        {prefs.view === "card" ? (
          <TabGrid
            tabs={group.tabs}
            columns={prefs.gridCols}
            onAddTab={onAddTab ? () => onAddTab(Number(group.key)) : undefined}
            selectedIds={selection.selectedIds}
            onSelect={selection.select}
            onFocus={onFocus}
            onClose={onCloseTab}
            onClassify={onClassify}
            onTabClick={onTabClick}
            onReadArticle={onReadArticle}
          />
        ) : (
          <TabList
            tabs={group.tabs}
            selectedIds={selection.selectedIds}
            onSelect={selection.select}
            onFocus={onFocus}
            onClose={onCloseTab}
            onClassify={onClassify}
            onTabClick={onTabClick}
            onReadArticle={onReadArticle}
          />
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
