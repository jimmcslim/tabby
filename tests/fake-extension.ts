import type {
  ChromeTab,
  ExtensionCommand,
  ExtensionCommandAck,
  ExtensionEvent,
  SyncResult,
} from "@/types"

/**
 * A stand-in for the Tabby Connector extension (`extension/background.js`),
 * speaking the same three-endpoint protocol against a running server:
 *
 *   - POST `/api/extension/sync`   — push a tab snapshot, receive backlog commands
 *   - GET  `/api/extension/events` — SSE stream of commands
 *   - POST `/api/extension/ack`    — report each command's outcome
 *
 * It keeps its own little model of Chrome's tab strip, so a test can open and
 * close "tabs" and watch what the server makes of them. The one deliberate
 * divergence from the real extension: local tab changes never schedule a
 * snapshot push. The real extension debounces one off every `chrome.tabs`
 * event; here every push is an explicit `sync()` call, so a test's timeline is
 * its own.
 */

/** One tab in the fake's simulated tab strip. */
export interface FakeTab {
  /** Numeric chrome.tabs id — the server sees it prefixed as `ext:<id>`. */
  id: number
  url: string
  title: string
  faviconUrl: string | null
  windowId: number
  active: boolean
  /** Chrome unloaded it (tabs.discard), or it was opened behind suspended.html */
  discarded: boolean
}

export interface OpenTabInit {
  url: string
  title?: string
  faviconUrl?: string | null
  windowId?: number
  active?: boolean
  discarded?: boolean
}

export interface FakeExtensionOptions {
  version?: string
}

const DEFAULT_VERSION = "test-0.0.1"
const DEFAULT_WINDOW_ID = 1

export class FakeExtension {
  readonly version: string
  /** Every command the server has pushed, in arrival order. */
  readonly commands: ExtensionCommand[] = []

  private readonly baseUrl: string
  private readonly tabsById = new Map<number, FakeTab>()
  private nextTabId = 1
  private abort: AbortController | null = null
  private streamClosed: Promise<void> | null = null
  private readonly watchers = new Set<() => void>()

  constructor(baseUrl: string, options: FakeExtensionOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "")
    this.version = options.version ?? DEFAULT_VERSION
  }

  // --- simulated tab strip ---------------------------------------------------

  openTab(init: OpenTabInit): FakeTab {
    const tab: FakeTab = {
      id: this.nextTabId++,
      url: init.url,
      title: init.title ?? init.url,
      faviconUrl: init.faviconUrl ?? null,
      windowId: init.windowId ?? DEFAULT_WINDOW_ID,
      active: init.active ?? false,
      discarded: init.discarded ?? false,
    }
    this.tabsById.set(tab.id, tab)
    return tab
  }

  closeTab(id: number): void {
    if (!this.tabsById.delete(id)) throw new Error(`No such tab: ${id}`)
  }

  closeAllTabs(): void {
    this.tabsById.clear()
  }

  get tabs(): FakeTab[] {
    return [...this.tabsById.values()]
  }

  get urls(): string[] {
    return this.tabs.map((t) => t.url)
  }

  findTabByUrl(url: string): FakeTab | undefined {
    return this.tabs.find((t) => t.url === url)
  }

  /** The tab strip as the server sees it — `chrome.tabs.query` shaped. */
  snapshot(): ChromeTab[] {
    return this.tabs.map((tab, index) => ({
      id: `ext:${tab.id}`,
      type: "page",
      title: tab.title,
      url: tab.url,
      faviconUrl: tab.faviconUrl ?? undefined,
      windowId: tab.windowId,
      tabIndex: index,
      lastAccessedAt: null,
      discarded: tab.discarded,
      frozen: false,
    }))
  }

  // --- protocol --------------------------------------------------------------

  /**
   * Push the current tab strip to the server. Commands that rode back on the
   * response (the backlog, used whenever SSE is down) are executed before this
   * resolves — the real extension fires them off without waiting, but a test
   * wants the work finished when the call returns.
   */
  async sync(options: { isStartup?: boolean } = {}): Promise<SyncResult | null> {
    const res = await this.post("/api/extension/sync", {
      extensionVersion: this.version,
      tabs: this.snapshot(),
      isStartup: !!options.isStartup,
    })
    if (!res.ok) throw new Error(`sync failed: ${res.status} ${await res.text()}`)

    const body = (await res.json()) as { result: SyncResult | null; commands?: ExtensionCommand[] }
    for (const command of body.commands ?? []) {
      this.commands.push(command)
      this.notifyWatchers()
      await this.executeCommand(command)
    }
    return body.result
  }

  /**
   * Open the SSE command stream, resolving once the server's `connected` event
   * has arrived — after that, `isExtensionSseConnected()` is true server-side
   * and command dispatch will reach this client.
   */
  async connect(): Promise<void> {
    if (this.abort) throw new Error("Already connected")

    const abort = new AbortController()
    this.abort = abort

    const res = await fetch(`${this.baseUrl}/api/extension/events`, { signal: abort.signal })
    if (!res.ok || !res.body) throw new Error(`events stream failed: ${res.status}`)

    let onConnected: () => void
    const connected = new Promise<void>((resolve) => {
      onConnected = resolve
    })

    this.streamClosed = this.readStream(res.body, () => onConnected()).catch(() => {
      // An aborted read is how disconnect() ends the stream — not an error.
    })

    await Promise.race([
      connected,
      Bun.sleep(5000).then(() => {
        throw new Error("Timed out waiting for the SSE `connected` event")
      }),
    ])
  }

  async disconnect(): Promise<void> {
    if (!this.abort) return
    this.abort.abort()
    this.abort = null
    await this.streamClosed
    this.streamClosed = null
  }

  /**
   * Resolve once a command matching `predicate` has arrived (commands already
   * received count). Use it to await work the server dispatches on its own,
   * such as the `open` commands a session restore emits.
   */
  async waitForCommand(
    predicate: (command: ExtensionCommand) => boolean,
    timeoutMs = 5000,
  ): Promise<ExtensionCommand> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const match = this.commands.find(predicate)
      if (match) return match
      if (Date.now() >= deadline) throw new Error("Timed out waiting for a matching command")
      await this.nextCommandOr(50)
    }
  }

  // --- internals -------------------------------------------------------------

  private async readStream(body: ReadableStream<Uint8Array>, onConnected: () => void) {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })

      let sep: number
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)

        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue
          let event: ExtensionEvent
          try {
            event = JSON.parse(line.slice(6)) as ExtensionEvent
          } catch {
            continue
          }
          if (event.type === "connected") onConnected()
          if (event.type !== "command") continue

          this.commands.push(event.command)
          this.notifyWatchers()
          // Fire-and-forget, as the real extension does: a command's handler
          // may itself push a snapshot, and blocking the reader on that would
          // deadlock against commands still arriving on this stream.
          void this.executeCommand(event.command)
        }
      }
    }
  }

  /** Mirrors `executeCommand` in extension/background.js, ack included. */
  private async executeCommand(command: ExtensionCommand): Promise<void> {
    const ack: ExtensionCommandAck = { commandId: command.id, ok: true }
    try {
      switch (command.type) {
        case "focus": {
          const tab = this.requireTab(command.tabId)
          for (const other of this.tabsById.values()) {
            if (other.windowId === tab.windowId) other.active = false
          }
          tab.active = true
          break
        }
        case "close": {
          this.requireTab(command.tabId)
          this.tabsById.delete(command.tabId as number)
          break
        }
        case "open": {
          const tab = this.openTab({
            url: command.url ?? "chrome://newtab/",
            title: command.title ?? command.url ?? "New tab",
            faviconUrl: command.faviconUrl ?? null,
            windowId: command.windowId ?? DEFAULT_WINDOW_ID,
            active: command.active ?? true,
            // A suspended tab really points at the extension's placeholder and
            // only loads `url` when visited; background.js unwraps it back to
            // the real url and reports it as discarded.
            discarded: !!command.suspend,
          })
          ack.data = {
            id: `ext:${tab.id}`,
            windowId: tab.windowId,
            url: tab.url,
            title: tab.title,
          }
          break
        }
        case "discard": {
          // Discarding replaces the tab — Chrome assigns it a new id.
          const tab = this.requireTab(command.tabId)
          this.tabsById.delete(tab.id)
          const replacement: FakeTab = { ...tab, id: this.nextTabId++, discarded: true }
          this.tabsById.set(replacement.id, replacement)
          ack.data = { id: `ext:${replacement.id}` }
          break
        }
        case "snapshot": {
          ack.data = await this.sync()
          break
        }
        default:
          throw new Error(`Unknown command: ${command.type}`)
      }
    } catch (e) {
      ack.ok = false
      ack.error = e instanceof Error ? e.message : String(e)
    }

    await this.post("/api/extension/ack", ack).catch(() => {
      // The real extension only warns — a lost ack times the command out.
    })
  }

  private requireTab(tabId: number | undefined): FakeTab {
    const tab = tabId === undefined ? undefined : this.tabsById.get(tabId)
    if (!tab) throw new Error(`No such tab: ${tabId}`)
    return tab
  }

  private post(path: string, body: unknown): Promise<Response> {
    return fetch(this.baseUrl + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  }

  private notifyWatchers(): void {
    for (const watcher of this.watchers) watcher()
    this.watchers.clear()
  }

  private nextCommandOr(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const watcher = () => {
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        this.watchers.delete(watcher)
        resolve()
      }, timeoutMs)
      this.watchers.add(watcher)
    })
  }
}
