// Bun keeps its jest-style test globals out of @types/bun's default surface —
// they are opt-in via this reference. Without it, a test written against the
// globals (describe/it/expect) fails `bun run typecheck` even though it runs.
/// <reference types="bun-types/test-globals" />
