"use client"

import { useSyncExternalStore } from "react"

/** Hydration never changes after it happens, so there is nothing to subscribe to. */
const subscribe = () => () => {}

/**
 * True once the client has hydrated, false on the server and during the
 * hydration render. Lets a component render a server-safe placeholder before
 * reading browser-only state, without a setState-in-effect.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
}
