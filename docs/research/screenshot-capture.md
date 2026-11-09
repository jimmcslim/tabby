# Screenshot capture: Firecrawl vs current OG/extension approach

Research for wayfinder ticket #4 (map #1). Researched 2026-11-09. Research only; no code changed.

## Verdict

**Drop Firecrawl for previews. Keep OG + extension capture. If server-side capture is ever wanted, use a small Playwright (or Browserless) sidecar behind the existing cache-miss seam.**

## What the fork does today (read from the code)

- **OG image**: `lib/og.ts` `fetchOgImage` does a plain `fetch` (5s timeout, UA `Tabby/1.0`) and regex-parses `og:image`, then `twitter:image`. Called from `lib/chrome/sync.ts` after each snapshot sync, capped at `OG_FETCH_LIMIT = 15` per sync; result stored in `tabs.og_image` (`lib/db/schema.ts`), `""` meaning checked-but-none. Tweets use Twitter's syndication endpoint instead. All enrichment is off with `TABBY_DISABLE_ENRICHMENT=1` (`lib/enrichment.ts`).
- **Extension capture**: `extension/background.js` waits 1.5s after tab activation / window focus, calls `chrome.tabs.captureVisibleTab` (JPEG q70) for the active http(s) tab, POSTs a data URL to `/api/extension/screenshot`. Requires `<all_urls>` (extension/README.md).
- **Storage**: `app/api/extension/screenshot/route.ts` writes `data/screenshots/<tabs.id>.jpg` (`lib/screenshots.ts`); files only, no DB column, no pruning, one file per tab (overwritten on recapture).
- **Serving**: `app/api/tabs/[tabId]/screenshot/route.ts`: file if present, else 302 to `og_image`, else 404. Its own comment says "A future on-demand capture backend (Firecrawl / Playwright) would slot in here where the cache misses."
- **UI**: `components/tabs/tab-card.tsx` prefers OG on a hard-coded domain list (`shouldPreferOgImage`: YouTube, GitHub, Reddit...), else the screenshot URL versioned by `lastAccessedAt`; tweets render a card.
- **Live data (read-only query of data/tabby.db, no server touched)**: 26,802 tab rows (1,057 open, 25,745 closed); og_image: 1,621 NULL, 10,533 "" (none), 14,387 with a URL. 3,650 screenshot files, 1.1 GB, avg ~311 KB each.
- **Gap**: only tabs the user has actually activated while the extension runs get a capture. Never-activated, background-restored, and closed-then-imported tabs get OG or a placeholder. This is the only thing server-side capture would improve.

## Firecrawl

- **Licence**: AGPL-3.0 for the repo (LICENSE file; GitHub API spdx `AGPL-3.0`; README "Open Source vs Cloud": "open source under the AGPL-3.0 license. The cloud version ... includes additional features"). For a personal/household self-host that calls it over HTTP, AGPL imposes little; it would bind if Tabby modified Firecrawl and offered it as a network service to others. A hosted multi-tenant Tabby would need to be careful.
- **Self-host status**: actively maintained (pushed 2026-11-08, ~200k stars). SELF_HOST.md: the Compose stack runs "the Firecrawl API and workers, Playwright, Redis, RabbitMQ, NuQ PostgreSQL, and FoundationDB services for the optional queue backend"; API unauthenticated by default; no persistent volumes defined; "not a production architecture".
- **Decisive finding: screenshots do not work in the self-hosted default stack.** The self-host guide states: "Screenshots or page actions: Not available in the default stack. Fetch and Playwright both report no support; both require Fire-engine." Confirmed in source: `apps/api/src/scraper/scrapeURL/engines/index.ts` sets `screenshot: false` and `"screenshot@fullScreen": false` for the `playwright` and `fetch` engines; only `fire-engine;*` engines support them. Fire-engine is Firecrawl's proprietary service, "not included".
- **Screenshot API (cloud)**: `formats: ["screenshot"]` with `screenshotOptions` `fullPage`, `quality`, `viewport`; returns a URL that expires after 24 hours (docs.firecrawl.dev/features/scrape), so Tabby would have to download and store it anyway.
- **Footprint** (docker-compose.yaml): playwright-service limit 2 CPU / 4 GB; API+workers limit 4 CPU / 8 GB; plus Redis, RabbitMQ, Postgres (and FDB definitions). Order of 12 GB of memory limits, far above the homelab-friendly bar, for a feature that does not even include screenshots.

## Alternatives

| Option | Licence | Screenshot support | Footprint / notes |
|---|---|---|---|
| Extension `captureVisibleTab` (current) | n/a (browser API) | Real logged-in rendering of what the user saw; free; private | Only visible active tab; needs `<all_urls>`; rate-limited (`MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`, "expensive and should not be called too often"); cannot capture unvisited tabs |
| Playwright sidecar (Node service wrapping `page.screenshot`) | Apache-2.0 (GitHub API) | Yes, first-class | One Chromium container; Playwright docs recommend `--init` and `--ipc=host` or "Chromium can run out of memory and crash". Tabby owns the code (~100 lines) and queueing. No cookies, so paywalled/login pages capture the login wall |
| Browserless (Docker) | `SSPL-1.0 OR Browserless Commercial License` (LICENSE) | Open image includes `/chromium/screenshot` (PNG/JPEG) | Ready-made REST; SSPL is awkward if Tabby ever becomes a hosted service; commercial licence needed for closed-source commercial use; stealth/CAPTCHA are cloud/enterprise only |
| shot-scraper (Python CLI over Playwright) | Apache-2.0 | Yes | CLI rather than service; fine for batch backfill |
| Gotenberg | MIT | HTML/URL to PDF; screenshot routes exist but its focus is PDF | Heavier than needed |
| Hosted screenshot APIs (Firecrawl cloud, Browserless cloud, etc.) | commercial | Yes | Allowed by the map only as optional; leaks the user's tab URLs (browsing history) to a third party, which is a privacy cost for a tab manager |

## Privacy and household notes

Any server-side capture fetches URLs from the server's network position, unauthenticated: it cannot see logged-in pages, and it exposes every tab URL to whatever runs it (a cloud API sees full browsing history). It also creates SSRF risk (private/internal URLs, `file:`), which the current OG fetch already has to some degree. Extension capture stays inside the user's own browser session and is the better default for a household tier (each member's own extension feeds their own previews). Storage today is a flat directory keyed by tab id with no per-user partitioning; a household tier would need per-user keys or paths regardless of capture method.

## Measured gap (2026-11-09, live DB read-only)

Of 1,061 open tabs: 18 have an extension screenshot file, 628 rely on an OG image alone, and **415 (39%) have no preview at all** (this count includes tabs whose OG fetch is still queued, not only confirmed-no-OG). Examples: CHIMERA, A Critique of GPUI, "How I'm fighting the AI Brain Fry": all return 200 but declare no `og:image`/`twitter:image`, and were opened in a background burst so the extension never captured them. The screenshot route therefore 404s. The same URL often exists as a closed duplicate that *does* have a capture.

## Recommendation

1. **Drop Firecrawl** as a preview backend: self-hosted screenshots are not supported without proprietary Fire-engine; the stack is heavy; cloud use leaks tab URLs; AGPL adds friction for no gain.
2. **Keep OG + extension capture** as the primary pipeline.
3. **The gap is real (39%), so close it in stages, cheapest first.** Each stage is independently shippable and should be its own `ready-for-agent` issue:
   - **Stage 1: reuse by URL.** In the screenshot route's cache-miss branch, fall back to a capture belonging to another tab row with the same URL (typically the closed duplicate). No new infrastructure. Must be scoped per user once a household tier exists.
   - **Stage 2: capture backend seam + Playwright sidecar.** Define a small `captureScreenshot(url)` interface and a Playwright (Apache-2.0) implementation in an optional Docker sidecar, off by default. Needs an SSRF guard (block private ranges, non-http schemes), a per-run cap like `OG_FETCH_LIMIT`, and a timeout. Writes the same `data/screenshots/<tabId>.jpg`, so serving is unchanged. Browserless could implement the same interface later.
   - **Stage 3: backfill.** A capped, resumable job (or `shot-scraper` CLI) that drains the 415 backlog gradually, using the same backend and guard. Only after Stage 2 is proven on new tabs.
   - **Independent, not blocking:** retention/pruning for the 1.1 GB cache; per-user screenshot paths for the household tier (do the path change before Stage 2 if the tier is near).
4. **Sequencing:** 1 first (small win now); 2 and 3 only if Stage 1 leaves a gap Jim still cares about. Server-side capture cannot see logged-in pages, so some tabs will remain preview-less by design.

## Open questions

- Is the remaining gap after Stage 1 worth running a headless browser for? (Re-measure after Stage 1.)
- Should the 1.1 GB screenshot cache get pruning/retention (closed tabs are 96% of rows)? Independent of this decision.
- Is any hosted/multi-tenant deployment contemplated? That is what would make AGPL/SSPL matter.
- Cloud Firecrawl screenshot pricing in credits was not verified; irrelevant given the drop recommendation.

## Sources

- https://github.com/firecrawl/firecrawl/blob/main/LICENSE ; https://github.com/firecrawl/firecrawl/blob/main/README.md ("Open Source vs Cloud")
- https://github.com/firecrawl/firecrawl/blob/main/SELF_HOST.md ; https://github.com/firecrawl/firecrawl/blob/main/docker-compose.yaml
- https://docs.firecrawl.dev/contributing/self-host ; https://docs.firecrawl.dev/features/scrape
- https://github.com/firecrawl/firecrawl/blob/main/apps/api/src/scraper/scrapeURL/engines/index.ts
- https://github.com/browserless/browserless/blob/main/LICENSE ; https://docs.browserless.io/enterprise/open-source
- https://playwright.dev/docs/docker ; https://github.com/microsoft/playwright (Apache-2.0)
- https://github.com/simonw/shot-scraper (Apache-2.0) ; https://github.com/gotenberg/gotenberg (MIT)
- https://developer.chrome.com/docs/extensions/reference/api/tabs (captureVisibleTab, MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND)
- Fork code: lib/og.ts, lib/chrome/sync.ts, lib/screenshots.ts, lib/db/schema.ts, app/api/extension/screenshot/route.ts, app/api/tabs/[tabId]/screenshot/route.ts, components/tabs/tab-card.tsx, extension/background.js
