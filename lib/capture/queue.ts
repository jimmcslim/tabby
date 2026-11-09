import type { DrainResult } from "./drain"

/**
 * In-memory queue in front of runDrain. The screenshot route only calls
 * enqueue(); a short debounce batches a page-load's worth of misses into one
 * capped drain, and drains never overlap. Ids a drain defers (cap reached) are
 * not requeued: the next cache miss for that tab enqueues it again, which is
 * how OG fetching drains its backlog too.
 */
export function createCaptureQueue(opts: {
  run: (ids: string[]) => Promise<DrainResult>
  delayMs?: number
}) {
  const delayMs = opts.delayMs ?? 2000
  let pending = new Set<string>()
  const inFlight = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<void> | null = null
  const waiters: (() => void)[] = []

  function settle() {
    if (!timer && !running) while (waiters.length) waiters.shift()!()
  }

  function schedule() {
    if (timer || running) return
    timer = setTimeout(() => {
      timer = null
      const ids = [...pending]
      pending = new Set()
      ids.forEach((id) => inFlight.add(id))
      running = opts
        .run(ids)
        .then(() => {})
        .catch(() => {})
        .finally(() => {
          ids.forEach((id) => inFlight.delete(id))
          running = null
          if (pending.size > 0) schedule()
          settle()
        })
    }, delayMs)
  }

  return {
    enqueue(id: string) {
      if (inFlight.has(id) || pending.has(id)) return
      pending.add(id)
      schedule()
    },
    /** Resolves once nothing is scheduled or running (for tests and shutdown). */
    idle(): Promise<void> {
      if (!timer && !running) return Promise.resolve()
      return new Promise((r) => waiters.push(r))
    },
  }
}
