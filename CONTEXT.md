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

### What the checks cover

`bun run typecheck` and `bun run lint` both include test files — tsconfig's `**/*.ts`
glob and the flat ESLint config pick them up with no extra configuration. CI
(`.github/workflows/ci.yml`) runs typecheck and lint on every PR; `bun test` joins it
once there are real suites to run.
