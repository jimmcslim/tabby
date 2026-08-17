"use client"

import type { GroupBy, SortBy } from "@/lib/tabs/grouping"
import type { UseTabViewPrefs } from "@/hooks/use-tab-view-prefs"
import type { UseClassify } from "@/hooks/use-classify"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { CloseDuplicatesAction } from "@/components/dialogs/close-duplicates-action"
import { SuspendStaleAction } from "@/components/dialogs/suspend-stale-action"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  SparklesIcon,
  GridViewIcon,
  ListViewIcon,
  SortByUp01Icon,
  SortByDown01Icon,
} from "@hugeicons/core-free-icons"

interface DashboardToolbarProps {
  /** The controls only appear once there are tabs to act on. */
  hasTabs: boolean
  prefs: UseTabViewPrefs
  classify: UseClassify
  /** Refetch after a hygiene action closed or suspended tabs. */
  onHygieneAction: () => void
}

/** The dashboard's header controls: view, grouping, sorting, hygiene, classify. */
export function DashboardToolbar({
  hasTabs,
  prefs,
  classify,
  onHygieneAction,
}: DashboardToolbarProps) {
  if (!hasTabs) return null

  return (
    <>
      <ToggleGroup
        variant="outline"
        size="sm"
        value={[prefs.view]}
        onValueChange={(value) => {
          const next = value[0] as "card" | "list" | undefined
          if (next) prefs.setView(next)
        }}
      >
        <ToggleGroupItem value="card" aria-label="Card view" title="Card view">
          <HugeiconsIcon icon={GridViewIcon} className="size-4" />
        </ToggleGroupItem>
        <ToggleGroupItem value="list" aria-label="List view" title="List view">
          <HugeiconsIcon icon={ListViewIcon} className="size-4" />
        </ToggleGroupItem>
      </ToggleGroup>

      <Select value={prefs.groupBy} onValueChange={(v) => prefs.setGroupBy(v as GroupBy)}>
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

      <Select value={prefs.sortBy} onValueChange={(v) => prefs.setSortBy(v as SortBy)}>
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

      <Button
        variant="outline"
        size="icon-sm"
        onClick={prefs.toggleSortDir}
        title={prefs.sortDir === "asc" ? "Sort ascending" : "Sort descending"}
        aria-label={prefs.sortDir === "asc" ? "Sort ascending" : "Sort descending"}
      >
        <HugeiconsIcon
          icon={prefs.sortDir === "asc" ? SortByUp01Icon : SortByDown01Icon}
          className="size-4"
        />
      </Button>

      <SuspendStaleAction onSuspended={onHygieneAction} />
      <CloseDuplicatesAction onClosed={onHygieneAction} />

      {classify.hasUnclassified && (
        <Button
          variant="outline"
          onClick={classify.classifyAllUnclassified}
          disabled={classify.classifyingAll}
        >
          <HugeiconsIcon icon={SparklesIcon} className="size-4" />
          {classify.classifyingAll ? "Classifying..." : "Classify All"}
        </Button>
      )}
    </>
  )
}
