# Tabby Connector (Chrome Extension)

Replaces the Chrome DevTools Protocol as Tabby's tab source, so Chrome no longer
shows the "being controlled by automated software / DevTools" banner. The
extension:

- pushes a full tab snapshot to the Tabby server whenever tabs change (debounced
  500ms) plus a safety sync every 30s,
- holds an SSE stream open to `/api/extension/events` so focus/close/open
  commands from the Tabby UI execute instantly,
- keeps a pinned Tabby tab at the far left of every window (Workona-style).

The server prefers the extension whenever it's connected or has reported within
the last 90 seconds; otherwise it falls back to CDP. Taking a **fresh tab
screenshot** still uses CDP and may flash the banner — everything else never
touches CDP while the extension is running.

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
`http://localhost:3000`). If you change it to another host/port, you must also
add that origin to `host_permissions` in `manifest.json` and reload the
extension — MV3 only exempts declared hosts from CORS.

## Caveats

- **Window names**: extension window IDs differ from CDP window IDs, so custom
  window names assigned while on CDP are orphaned once after switching sources;
  just re-name the windows. Tabs themselves are rebound by URL and are not
  closed/re-added on switch-over.
- **No auth**: like the rest of Tabby, the extension endpoints are
  unauthenticated and intended for localhost use only.
