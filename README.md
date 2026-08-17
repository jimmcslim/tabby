<div align="center">

# Tabby

**Chrome tab manager with AI-powered organization**

Auto-discovers open tabs via a companion Chrome extension, saves browsing sessions, and uses Ollama for classification, summarization, and smart grouping.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/dark-mode.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/light-mode.png">
  <img alt="Tabby dashboard" src="docs/light-mode.png" width="100%">
</picture>

<br>

<sub>Light and dark mode with live tab previews, AI classification, and window grouping</sub>

</div>

<br>

## Features

- **Auto-sync** — The Tabby Connector extension pushes tab changes within ~1s (debounced) plus a 30s safety sync, tracking tab lifecycle with full history
- **Tab management** — Focus, close, reopen tabs directly from the UI
- **Window grouping** — Tabs grouped by Chrome window with renamable window labels
- **Sessions** — Save, restore, import/export browsing session snapshots. Auto-saves "Latest" on every sync
- **Groups** — Organize tabs into named collections, manually or via AI suggestions
- **AI classification** — Auto-categorize tabs (work, social, dev, news, etc.) with article detection
- **AI summarization** — Generate page summaries, auto-summarize articles on sync
- **Reader mode** — Distraction-free article reader for long-form content
- **Duplicate detection** — Find and close duplicate tabs across windows
- **Stale tab detection** — Identify tabs not used for 24+ hours and suspend them (`chrome.tabs.discard` — memory freed, tab stays put)
- **OG image enrichment** — Auto-fetch preview images for YouTube, Twitter, LinkedIn, etc.
- **Tweet extraction** — Fetch tweet content and author info for Twitter/X tabs
- **Tab previews** — The extension captures the visible tab as you browse; previews build up naturally
- **Command palette** — `Cmd+K` to search tabs, history, sessions, groups, and run actions
- **Dark mode** — System-aware theme with toggle

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| UI | shadcn/ui v4 (Base UI + Tailwind v4) |
| Icons | Hugeicons |
| Database | SQLite via Drizzle ORM + `bun:sqlite` |
| Chrome | Companion MV3 extension (snapshot push + SSE command stream) |
| AI | Ollama (local inference) |
| Runtime | Bun |
| Deployment | Docker |

## Quick Start

### 1. Install the Chrome extension

In your normal Chrome — no flags, no separate profile, no DevTools banner:

1. Open `chrome://extensions` and enable **Developer mode**
2. Click **Load unpacked** and select this repo's [`extension/`](extension/) folder

The extension connects to the Tabby server automatically and pins a Tabby tab to the left of every window. See [extension/README.md](extension/README.md) for details.

### 2. Run with Docker

```bash
docker compose up --build
```

For live-reloading during development:

```bash
docker compose watch
```

### 3. Run natively

```bash
bun install
bun dev
```

Open [http://localhost:3000](http://localhost:3000). Tabs sync automatically within 30 seconds.

## Architecture

See [docs/architecture.md](docs/architecture.md) for sequence diagrams of the sync, polling, and command flows.

### Chrome Extension

Tab state and tab actions flow through the **Tabby Connector** extension ([`extension/`](extension/)), a Manifest V3 service worker:

- **Snapshots** — `chrome.tabs`/`chrome.windows` events trigger a debounced (500ms) full-tab snapshot POST to `/api/extension/sync`, plus a 30s alarm safety sync. Snapshots include per-tab window, strip position, last-accessed time, and suspension state.
- **Commands** — the worker holds an SSE stream open to `/api/extension/events`; the server pushes focus/close/open/discard commands instantly and receives acks on `/api/extension/ack`. Commands queued while the stream is down piggyback on the next snapshot response.
- **Previews** — on tab activation the worker captures the visible tab (`chrome.tabs.captureVisibleTab`) and stores it via `/api/extension/screenshot`.
- **Pinned tab** — a pinned Tabby tab is maintained at index 0 of every window, Workona-style.

### Sync Flow

On every tab change (debounced) and at least every 30 seconds:
1. Extension pushes a full snapshot of Chrome's tabs
2. Diff against database — add new tabs, update existing, mark closed (URL-rebind pass survives Chrome restarts without churning history)
3. Enrich special domains (OG images for YouTube/LinkedIn, tweet data for Twitter/X)
4. Update the auto-saved "Latest" session
5. Auto-classify and auto-summarize new tabs via Ollama (background, non-blocking)

### Database

SQLite with WAL mode, managed via Drizzle ORM. Migrations run automatically on startup from `lib/db/migrations`.

| Table | Purpose |
|-------|---------|
| `tabs` | All tabs (open + closed history) with metadata, category, summary |
| `groups` | Named tab collections |
| `tabs_to_groups` | Many-to-many join (cascade delete) |
| `sessions` | Session snapshots (auto + manual) |
| `session_tabs` | Tabs within sessions (copies, not references) |
| `settings` | Key-value store (window names, etc.) |

### Ollama (optional)

All AI features require a local [Ollama](https://ollama.com) instance. The app works fully without it — AI buttons are disabled when Ollama is unreachable.

AI capabilities:
- **Classification** — Categorizes tabs into 10 categories + detects readable articles
- **Summarization** — 2-3 sentence summaries from page content
- **Group suggestions** — Proposes logical tab groupings based on content similarity
- **Auto-processing** — Classifies and summarizes new tabs after each sync (background)

## API Reference

### Tabs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tabs` | List tabs (filter: `status`, `category`, `search`) |
| PATCH | `/api/tabs/[tabId]` | Update tab metadata |
| DELETE | `/api/tabs/[tabId]` | Delete tab from database |
| POST | `/api/tabs/sync` | Trigger Chrome sync |
| POST | `/api/tabs/bulk` | Bulk close or delete (`{ tabIds, action }`) |
| GET | `/api/tabs/stale` | Find tabs not used for N hours |
| POST | `/api/tabs/stale` | Suspend stale tabs (`chrome.tabs.discard`) |
| GET | `/api/tabs/[tabId]/reader` | Fetch article content |
| GET | `/api/tabs/[tabId]/screenshot` | Serve cached tab preview (or OG image) |

### Chrome

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/chrome/status` | Connection status + browser version |
| POST | `/api/chrome/focus` | Focus tab in Chrome |
| POST | `/api/chrome/close` | Close tab in Chrome |
| POST | `/api/chrome/open` | Open URL in Chrome |
| GET | `/api/chrome/close-duplicates` | Detect duplicate tabs |
| POST | `/api/chrome/close-duplicates` | Close duplicate tabs |

### Extension (called by the Tabby Connector)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/extension/sync` | Ingest a full tab snapshot; response piggybacks queued commands |
| GET | `/api/extension/events` | SSE stream delivering commands to the extension |
| POST | `/api/extension/ack` | Command results |
| POST | `/api/extension/screenshot` | Store a capture of the visible tab |

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions` | List all sessions |
| POST | `/api/sessions` | Save current tabs as named session |
| GET | `/api/sessions/[id]` | Get session with tabs |
| PATCH | `/api/sessions/[id]` | Rename session |
| DELETE | `/api/sessions/[id]` | Delete session |
| POST | `/api/sessions/[id]/restore` | Restore all tabs to Chrome |
| GET | `/api/sessions/[id]/export` | Download as JSON |
| POST | `/api/sessions/import` | Import from JSON |

### Groups

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/groups` | List groups with tab counts |
| POST | `/api/groups` | Create group |
| PATCH | `/api/groups/[id]` | Update group |
| DELETE | `/api/groups/[id]` | Delete group |
| GET | `/api/groups/[id]/tabs` | Get tabs in group |
| POST | `/api/groups/[id]/tabs` | Add/remove tabs |

### AI

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/ai/status` | Ollama connection + available models |
| POST | `/api/ai/classify` | Classify tabs into categories |
| POST | `/api/ai/summarize` | Summarize tab content |
| POST | `/api/ai/suggest-groups` | AI-powered group suggestions |

### Settings

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings` | Get app settings (sync interval) |
| PUT | `/api/settings` | Update app settings |
| GET | `/api/window-names` | Get custom window names |
| PUT | `/api/window-names` | Set/clear window name |

## Session Export Format

```json
{
  "version": 1,
  "exportedAt": "2026-03-15T12:00:00.000Z",
  "session": {
    "name": "Work tabs Friday",
    "createdAt": "2026-03-15T10:00:00.000Z",
    "tabs": [
      {
        "url": "https://example.com",
        "title": "Example",
        "domain": "example.com",
        "faviconUrl": null,
        "category": "work",
        "position": 0
      }
    ]
  }
}
```

Import validates: version 1, non-empty name, non-empty tabs, valid URLs (blocks `javascript:`, `data:`, `vbscript:`), max 1000 tabs.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_PATH` | `./data/tabby.db` | SQLite database location |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API endpoint |
| `OLLAMA_MODEL` | `qwen3.5:latest` | Model for AI features |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+K` | Open command palette |
| `Cmd+S` | Quick-save current session |
| `Cmd+B` | Toggle sidebar |
| `D` | Toggle dark/light theme |

## Project Structure

```
tabby/
├── app/
│   ├── page.tsx                    # Dashboard
│   ├── history/page.tsx            # Closed tabs history
│   ├── sessions/page.tsx           # Session management
│   ├── groups/page.tsx             # Group management
│   ├── settings/page.tsx           # Configuration
│   └── api/                        # 25 API endpoints
├── components/
│   ├── tabs/                       # Tab UI (cards, grid, detail, reader)
│   ├── sessions/                   # Session UI (cards, dialogs)
│   ├── groups/                     # Group UI (cards, dialogs, AI suggest)
│   ├── layout/                     # App shell, sidebar, header
│   ├── shared/                     # Favicon, category badge, empty state
│   ├── providers/                  # Sync + theme context providers
│   ├── ui/                         # shadcn/ui components
│   └── command-palette.tsx         # Cmd+K palette
├── extension/                      # Tabby Connector Chrome extension (MV3)
│   ├── manifest.json
│   ├── background.js               # Snapshots, SSE commands, captures, pinned tab
│   └── popup.html / popup.js       # Status + server URL
├── lib/
│   ├── chrome/actions.ts           # Tab actions dispatched to the extension
│   ├── chrome/sync.ts              # Tab sync/diff logic
│   ├── chrome/workona.ts           # Workona suspended-tab URL unwrap
│   ├── extension/bridge.ts         # SSE subscribers + command queue + acks
│   ├── screenshots.ts              # Preview cache paths
│   ├── db/schema.ts                # Drizzle ORM schema
│   ├── db/index.ts                 # Database connection
│   ├── sessions/auto-save.ts       # Auto-save "Latest" session
│   ├── ai/auto-process.ts          # Background AI processing
│   ├── ollama.ts                   # Ollama API client
│   └── og.ts                       # OG image + tweet extraction
├── types/index.ts                  # TypeScript interfaces
├── Dockerfile                      # Multi-stage Bun build
└── docker-compose.yml              # App container
```
