"use client"

import { useCallback, useState } from "react"

export interface UseTabSelection {
  selectedIds: Set<string>
  count: number
  select: (id: string, selected: boolean) => void
  deselect: (ids: string[]) => void
  clear: () => void
}

/** Which tabs are ticked, and the bulk-action bar's arithmetic. */
export function useTabSelection(): UseTabSelection {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const select = useCallback((id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (selected) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  // Called when tabs leave the list (closed individually, in bulk, or by group)
  // so the selection never keeps ids that no longer exist.
  const deselect = useCallback((ids: string[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const id of ids) next.delete(id)
      return next
    })
  }, [])

  const clear = useCallback(() => setSelectedIds(new Set()), [])

  return { selectedIds, count: selectedIds.size, select, deselect, clear }
}
