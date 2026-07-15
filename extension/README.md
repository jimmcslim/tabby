# Tabby Connector (Chrome Extension)

Tabby's only Chrome integration — no DevTools Protocol, no debug port, no
"browser is being controlled" banner. The extension:

- pushes a full tab snapshot to the Tabby server whenever tabs change (debounced
  500ms) plus a safety sync every 30s, including per-tab strip position,
  last-accessed time, and suspension state (Memory Saver / frozen / Workona),
- holds an SSE stream open to `/api/extension/events` so focus/close/open/
  suspend commands from the Tabby UI execute instantly,
- captures the visible tab when you switch to it (`chrome.tabs.captureVisibleTab`)
  and stores it as the tab's preview image,
- keeps a pinned Tabby tab at the far left of every window (Workona-style).

## Install (unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this `extension/` directory

Check it's working: the extension's service-worker console (click "service
worker" on the extension card) should log `[tabby] SSE connected`, and
`GET http://localhost:3000/api/chrome/status` should report
`"source": "extension"`.

## Configuration

Click the toolbar icon to set the Tabby server URL (default
`http://localhost:3000`).

## Permissions

- `tabs` — read tab titles/URLs, execute tab actions
- `<all_urls>` — required by `captureVisibleTab` for tab previews (the
  extension only captures the tab you just switched to, and only sends it to
  your Tabby server)
- `storage`, `alarms` — settings and the 30s watchdog

## Caveats

- **No auth**: like the rest of Tabby, the extension endpoints are
  unauthenticated and intended for localhost use only.
- If Tabby runs on a non-default host/port, add that origin to
  `host_permissions` in `manifest.json` and reload the extension.
