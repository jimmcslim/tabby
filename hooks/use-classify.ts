"use client"

import { useCallback, useState } from "react"
import type { ClassifyResponse, Tab } from "@/types"

export interface UseClassify {
  /** True while "Classify All" is running. */
  classifyingAll: boolean
  /** True while the bulk action bar's classify is running. */
  bulkClassifying: boolean
  /** Any tab still lacking a category — drives the "Classify All" button. */
  hasUnclassified: boolean
  classifyTab: (tabId: string) => Promise<void>
  classifyTabs: (tabIds: string[]) => Promise<void>
  classifyAllUnclassified: () => Promise<void>
}

async function classify(tabIds: string[]): Promise<ClassifyResponse["results"]> {
  const res = await fetch("/api/ai/classify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tabIds }),
  })
  if (!res.ok) return []
  const data: ClassifyResponse = await res.json()
  return data.results ?? []
}

/** AI classification of tabs — one, a selection, or every unclassified one. */
export function useClassify(
  tabs: Tab[],
  applyClassifications: (results: ClassifyResponse["results"]) => void,
): UseClassify {
  const [classifyingAll, setClassifyingAll] = useState(false)
  const [bulkClassifying, setBulkClassifying] = useState(false)

  const classifyTab = useCallback(
    async (tabId: string) => {
      applyClassifications(await classify([tabId]))
    },
    [applyClassifications],
  )

  const classifyTabs = useCallback(
    async (tabIds: string[]) => {
      setBulkClassifying(true)
      try {
        applyClassifications(await classify(tabIds))
      } finally {
        setBulkClassifying(false)
      }
    },
    [applyClassifications],
  )

  const classifyAllUnclassified = useCallback(async () => {
    const unclassified = tabs.filter((t) => !t.category)
    if (unclassified.length === 0) return
    setClassifyingAll(true)
    try {
      applyClassifications(await classify(unclassified.map((t) => t.id)))
    } finally {
      setClassifyingAll(false)
    }
  }, [tabs, applyClassifications])

  return {
    classifyingAll,
    bulkClassifying,
    hasUnclassified: tabs.some((t) => !t.category),
    classifyTab,
    classifyTabs,
    classifyAllUnclassified,
  }
}
