# Tabby — project context

Tabby is a self-hosted Chrome tab manager: a Chrome extension pushes tab snapshots to a
Next.js app, which stores them in SQLite (via Drizzle) and provides search, grouping,
sessions and AI classification over them.

## Testing

The test runner is **`bun test`** (`bun run test`). No other runner is configured.

### Where tests live

- **Unit tests are colocated**: `lib/chrome/workona.ts` → `lib/chrome/workona.test.ts`.
  A test sits next to the thing it tests, so moving or deleting a module takes its test
  with it.
- **`tests/`** at the repo root is reserved for the end-to-end harness and shared
  fixtures — anything that needs a server, a database, or a fake extension, rather than
  a pure function.
- The file suffix is **`.test.ts`** (`.test.tsx` for component tests). Bun also
  discovers `_test`/`.spec` variants; don't use them, so the convention stays one thing.

### Writing a test

Import the API explicitly from `bun:test`:

```ts
import { describe, expect, it } from "bun:test"
```

The jest-style globals (`describe`, `it`, `expect`, …) also typecheck — `types/bun-test-globals.d.ts`
opts into Bun's `test-globals` declarations, which `@types/bun` does not expose by default.
Explicit imports are still preferred: they say where the API comes from.

### The end-to-end harness

`tests/` holds a fake-extension harness that exercises the server the way the Chrome
extension does — no browser involved. Two pieces:

- **`tests/server.ts`** — `startTestServer()` boots the Next.js dev server on its own
  port (from 3001 upward; **never 3000**, where a developer's own `bun run dev` and the
  real database live), against a scratch `DATABASE_PATH` under the OS temp dir, into a
  separate `.next-test` build directory, with `TABBY_DISABLE_ENRICHMENT=1`. It waits for
  readiness and then warms every route the suite touches: Turbopack compiles a route on
  first request, and a cold compile can outlast the bridge's 5s command-ack timeout.
  `stop()` kills the process group and deletes the scratch directory.
- **`tests/fake-extension.ts`** — `FakeExtension` speaks the bridge protocol
  (`/api/extension/sync`, `/api/extension/events` SSE, `/api/extension/ack`) over a
  simulated tab strip, so a test can open and close "tabs" and assert on what the HTTP
  API makes of them. Unlike the real extension it never pushes a snapshot on its own:
  every push is an explicit `sync()`, so a test controls its own timeline.

One server per suite file (`beforeAll`/`afterAll`) — booting is the slow part, and
nothing here runs a browser or a second Chrome process.

`next dev` writes its generated-types globs into `tsconfig.json` on boot, so the
`.next-test/dev/types` entries there are the harness's, committed deliberately: with them
present a test run leaves `tsconfig.json` untouched instead of dirtying the tree.

**`TABBY_DISABLE_ENRICHMENT=1`** (see `lib/enrichment.ts`) suppresses everything a sync
kicks off besides the tab writes: OG image fetches, tweet lookups, and the Ollama
classify/summarize pass. It is what lets the suite run offline and deterministically with
no Ollama present. It is documented alongside `DATABASE_PATH` in the README.

### What the checks cover

`bun run typecheck` and `bun run lint` both include test files — tsconfig's `**/*.ts`
glob and the flat ESLint config pick them up with no extra configuration. CI
(`.github/workflows/ci.yml`) runs typecheck and lint on every PR; `bun test` joins it
once there are real suites to run. The end-to-end suite is headless and needs no network
beyond localhost, so a single `bun test` invocation is all CI will need.
