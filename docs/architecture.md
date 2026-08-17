# Architecture

How a browser event becomes a row in the database, and how a click in the Tabby UI becomes an action in Chrome. Four actors appear throughout:

- **Chrome** — the browser itself: tab and window events, and the `chrome.tabs` API.
- **Extension** — the Tabby Connector ([`extension/background.js`](../extension/background.js)), a Manifest V3 service worker.
- **API** — the Next.js app's route handlers under [`app/api/`](../app/api/), running on Bun.
- **DB** — SQLite via Drizzle ORM + `bun:sqlite` ([`lib/db/schema.ts`](../lib/db/schema.ts)): WAL mode, migrations applied on boot from `lib/db/migrations`, location set by `DATABASE_PATH`.

Three distinct channels connect them:

1. **Extension → server** is plain HTTP: snapshots to `POST /api/extension/sync`, command results to `POST /api/extension/ack`, previews to `POST /api/extension/screenshot`.
2. **Server → extension** is a Server-Sent Events stream (`GET /api/extension/events`) that pushes commands (`focus` / `close` / `open` / `discard` / `snapshot`). Each command carries an id; the extension acks it, resolving a pending promise on the server ([`lib/extension/bridge.ts`](../lib/extension/bridge.ts)) with a 5-second timeout. Commands dispatched while no stream is connected sit in a backlog and piggyback on the next snapshot response.
3. **Browser UI → server** is ordinary polling. The Tabby page never opens an SSE connection — it refetches on a timer.

## Flow 1: A tab changes in Chrome

Every tab and window event funnels into one debounced snapshot push. The server diffs the snapshot against the database in a single transaction, then kicks off enrichment in the background.

```mermaid
sequenceDiagram
    autonumber
    participant Chrome
    participant Ext as Extension
    participant API as Next.js API
    participant DB as SQLite

    Chrome->>Ext: tabs.onCreated / onRemoved / onMoved / onActivated /<br/>onAttached / onDetached / onReplaced / onUpdated,<br/>windows.onCreated / onRemoved
    Ext->>Ext: scheduleSnapshot() — 500ms debounce
    Note over Ext: A 30s watchdog alarm also pushes a snapshot<br/>and reconnects the SSE stream if it dropped
    Ext->>API: POST /api/extension/sync<br/>(extensionVersion, tabs[], isStartup)
    API->>DB: read open tabs (one transaction begins)
    API->>API: reconcileTabs() — URL-rebind pass,<br/>plan inserts / updates / closes
    API->>DB: apply plan + syncAutoSessions()<br/>(rolling "Latest" / "Previous Session"), commit
    API-->>Ext: result + any backlogged commands
    Ext->>Chrome: execute piggybacked commands, if any
    Note over API,DB: After commit, fire-and-forget (skipped when<br/>TABBY_DISABLE_ENRICHMENT is set):<br/>OG-image fetches (max 15 per sync), tweet lookups,<br/>and autoProcessTabs() — Ollama classify (batches of 20)<br/>and summarize (max 5 per cycle) — each writing back to DB
```

Two side notes on this flow:

- **Restore lock** — while a session restore is reopening tabs, `POST /api/extension/sync` short-circuits: it records the report and returns backlogged commands without running the reconcile, so each reopened tab doesn't trigger a full diff mid-restore.
- **Previews** — separately from snapshots, tab activation starts a 1.5s timer, then `chrome.tabs.captureVisibleTab` posts a JPEG to `POST /api/extension/screenshot`, which lands in the image file cache that `GET /api/tabs/[tabId]/screenshot` serves to the UI.

## Flow 2: Viewing the Tabby main page

The dashboard ([`app/page.tsx`](../app/page.tsx)) is fully client-side. [`components/providers/sync-provider.tsx`](../components/providers/sync-provider.tsx) polls on an interval (default 30s, configurable via `/api/settings`; 2s while a session restore is in progress). Note the inversion inside `POST /api/tabs/sync`: the server asks the *extension* for fresh state by dispatching a `snapshot` command over the same bridge used for tab actions.

```mermaid
sequenceDiagram
    autonumber
    participant UI as Browser UI<br/>(Tabby page)
    participant API as Next.js API
    participant Ext as Extension
    participant DB as SQLite

    loop every 30s (2s while restoring)
        UI->>API: GET /api/chrome/status
        API-->>UI: connected? (SSE subscriber present,<br/>or a snapshot within the last 90s)
        alt extension connected
            UI->>API: POST /api/tabs/sync
            API->>Ext: dispatch "snapshot" command over SSE
            Ext->>API: POST /api/extension/sync — fresh snapshot<br/>(reconcile runs as in Flow 1)
            Ext->>API: POST /api/extension/ack with the sync result
            API-->>UI: sync result<br/>(on 5s timeout: last known result instead)
            UI->>API: GET /api/tabs?status=open
            API->>DB: SELECT open tabs
            API-->>UI: tabs JSON — page re-renders
        end
    end
    Note over UI,API: Tab cards lazy-load previews via<br/>GET /api/tabs/[tabId]/screenshot
```

Grouping and sorting happen client-side; only the search box reaches the server (a SQL `LIKE` on tab titles in `GET /api/tabs`).

## Flow 3: Closing a tab from the UI

Tab actions never touch Chrome directly — they run through the command bridge. `close` is shown here; `focus` (`POST /api/chrome/focus`) and `open` (`POST /api/chrome/open`) follow the same shape.

```mermaid
sequenceDiagram
    autonumber
    participant UI as Browser UI<br/>(Tabby page)
    participant API as Next.js API
    participant DB as SQLite
    participant Ext as Extension
    participant Chrome

    UI->>API: POST /api/chrome/close (tabId)
    API->>DB: look up the tab's Chrome id
    API->>API: dispatchCommand("close") — pending promise,<br/>5s timeout
    API->>Ext: SSE event: close command (with command id)
    Ext->>Chrome: chrome.tabs.remove()
    Ext->>API: POST /api/extension/ack (commandId, ok)
    API->>DB: UPDATE tab: status "closed", chromeId cleared
    API-->>UI: success
    Note over API,UI: If the extension is disconnected, times out,<br/>or the ack reports an error, the route returns 502<br/>and the row is left untouched
    Note over Chrome,Ext: Independently, tabs.onRemoved fires in the extension,<br/>so a debounced snapshot (Flow 1) reconciles the same<br/>close even if the ack path failed
```

## Key files

| File | Role |
|------|------|
| [`extension/background.js`](../extension/background.js) | Event listeners, snapshot debounce, SSE client, command execution, previews |
| [`lib/extension/bridge.ts`](../lib/extension/bridge.ts) | SSE subscribers, command dispatch/backlog, pending-ack promises, restore lock |
| [`lib/chrome/sync.ts`](../lib/chrome/sync.ts) | `syncTabsFromList` transaction + enrichment kickoff; `syncTabs` snapshot request |
| [`lib/chrome/reconcile.ts`](../lib/chrome/reconcile.ts) | Pure snapshot-vs-DB diff planner (URL-rebind pass lives here) |
| [`lib/chrome/actions.ts`](../lib/chrome/actions.ts) | focus/close/open/discard wrappers over `dispatchCommand` |
| [`components/providers/sync-provider.tsx`](../components/providers/sync-provider.tsx) | The UI polling loop (status → sync → refetch) |
| [`lib/db/schema.ts`](../lib/db/schema.ts) | Drizzle schema: `tabs`, `groups`, `tabs_to_groups`, `sessions`, `session_tabs`, `settings` |

For the full route list and environment variables, see the [API Reference](../README.md#api-reference) and [Environment Variables](../README.md#environment-variables) sections of the README.
