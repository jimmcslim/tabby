"use client"

import { useEffect, useRef } from "react"

interface LoadMoreSentinelProps {
  /** The scrolling element the list lives in (the observer's root). */
  root: React.RefObject<HTMLElement | null>
  /** Another page can be loaded. */
  hasMore: boolean
  /** A page is already loading — don't ask again. */
  loading: boolean
  onLoadMore: () => void
  /**
   * Changes whenever the list grows. The observer is rebuilt on each change so
   * a sentinel that is *still* in view after a page lands (a tall window, a
   * short page) fires again instead of leaving the list stuck.
   */
  itemCount: number
}

/** An empty element at the end of a list; asks for more when it nears the viewport. */
export function LoadMoreSentinel({ root, hasMore, loading, onLoadMore, itemCount }: LoadMoreSentinelProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !hasMore || loading) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onLoadMore()
      },
      // Start loading well before the user hits the bottom.
      { root: root.current, rootMargin: "0px 0px 600px 0px" },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [root, hasMore, loading, onLoadMore, itemCount])

  return <div ref={ref} aria-hidden className="h-px" />
}
