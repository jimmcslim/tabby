"use client"

import { useRef } from "react"
import { useSyncContext } from "@/components/providers/sync-provider"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { HugeiconsIcon } from "@hugeicons/react"
import { Search01Icon, ArrowReloadHorizontalIcon, Cancel01Icon } from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"

interface HeaderProps {
  title: string
  searchValue: string
  onSearchChange: (value: string) => void
  children?: React.ReactNode
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 5) return "just now"
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ago`
}

export function Header({ title, searchValue, onSearchChange, children }: HeaderProps) {
  const { lastSync, isSyncing, triggerSync, chromeStatus } = useSyncContext()
  const searchRef = useRef<HTMLInputElement>(null)
  const hasSearchText = searchValue.trim() !== ""
  const clearSearch = () => {
    onSearchChange("")
    searchRef.current?.focus()
  }
  const restoreProgress = chromeStatus?.restoring ? chromeStatus.restoreProgress : undefined

  return (
    <header className="flex items-center gap-4 border-b px-8 py-4">
      <h1 className="text-xl font-bold">{title}</h1>

      {/* Sync status */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={triggerSync}
          disabled={isSyncing}
        >
          <HugeiconsIcon
            icon={ArrowReloadHorizontalIcon}
            className={cn("size-3.5", isSyncing && "animate-spin")}
          />
        </Button>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {chromeStatus?.restoring ? (
            <>
              <div className="size-1.5 animate-pulse rounded-full bg-blue-500" />
              Restoring{restoreProgress ? ` ${restoreProgress.restored}/${restoreProgress.total}` : "..."}
            </>
          ) : isSyncing ? (
            <>
              <div className="size-1.5 animate-pulse rounded-full bg-amber-500" />
              Syncing...
            </>
          ) : lastSync ? (
            <>
              <div className="size-1.5 rounded-full bg-green-500" />
              Synced {timeAgo(lastSync)}
            </>
          ) : (
            <>
              <div className="size-1.5 rounded-full bg-muted-foreground" />
              Not synced
            </>
          )}
        </div>
      </div>

      <div className="ml-auto flex items-center gap-3">
        {/* Search */}
        <div className="relative">
          <HugeiconsIcon
            icon={Search01Icon}
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={searchRef}
            placeholder="Search tabs..."
            className="w-64 pl-9 pr-9"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              // Escape clears a non-empty search; on an empty field it keeps its
              // default behaviour (e.g. closing an open popup) untouched.
              if (e.key === "Escape" && hasSearchText) {
                e.preventDefault()
                clearSearch()
              }
            }}
          />
          {hasSearchText && (
            <button
              type="button"
              className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Clear search"
              aria-label="Clear search"
              onClick={clearSearch}
            >
              <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
            </button>
          )}
        </div>
        {children}
      </div>
    </header>
  )
}
