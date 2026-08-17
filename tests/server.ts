import { spawn, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * Boots the Next.js app for end-to-end tests: its own dev server, its own
 * scratch SQLite file, enrichment off.
 *
 * Three things this deliberately never touches:
 *
 *   - **Port 3000.** That is where a developer's own `bun run dev` lives, with
 *     the real database behind it. The harness starts looking at 3001 and
 *     refuses 3000 outright.
 *   - **`data/tabby.db`.** `DATABASE_PATH` points at a fresh file under the OS
 *     temp dir, deleted on `stop()`.
 *   - **`.next`.** Two `next dev` processes sharing one build directory
 *     corrupt each other, so this one builds into `.next-test` (see
 *     `distDir` in next.config.mjs).
 *
 * One server per suite, started in `beforeAll` and stopped in `afterAll` —
 * booting is the expensive part, and nothing here runs a browser.
 */

/** Where a developer's own dev server lives. Never ours. */
const DEV_SERVER_PORT = 3000
const FIRST_TEST_PORT = 3001
const PORT_SCAN_LIMIT = 50

/** Dev-server boot includes a cold Turbopack compile, so be patient. */
const BOOT_TIMEOUT_MS = 180_000
const SHUTDOWN_GRACE_MS = 5_000

const REPO_ROOT = path.resolve(import.meta.dir, "..")

export interface TestServer {
  /** e.g. `http://127.0.0.1:3001` */
  baseUrl: string
  /** The scratch SQLite file this server is running against. */
  dbPath: string
  stop(): Promise<void>
}

export async function startTestServer(): Promise<TestServer> {
  const port = await findFreePort()
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabby-e2e-"))
  const dbPath = path.join(scratchDir, "tabby.db")
  const baseUrl = `http://127.0.0.1:${port}`

  const child = spawn(
    "bun",
    ["--bun", "next", "dev", "--turbopack", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: REPO_ROOT,
      // Its own process group: `next dev` forks workers, and killing the group
      // is the only way to be sure none of them outlive the test run.
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        DATABASE_PATH: dbPath,
        TABBY_DISABLE_ENRICHMENT: "1",
        NEXT_DIST_DIR: ".next-test",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  )

  // Kept only to explain a failed boot — a healthy run never prints it.
  let output = ""
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString()
  })
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString()
  })

  // Last-resort net: if the test process dies before afterAll runs, don't
  // leave a dev server holding the port.
  const killOnExit = () => killGroup(child, "SIGKILL")
  process.once("exit", killOnExit)

  const stop = async () => {
    process.off("exit", killOnExit)
    if (child.exitCode === null && child.signalCode === null) {
      killGroup(child, "SIGTERM")
      await Promise.race([once(child, "exit"), Bun.sleep(SHUTDOWN_GRACE_MS)])
      if (child.exitCode === null && child.signalCode === null) killGroup(child, "SIGKILL")
    }
    fs.rmSync(scratchDir, { recursive: true, force: true })
  }

  try {
    await waitUntilReady(baseUrl, child, () => output)
    await warmUpRoutes(baseUrl)
  } catch (e) {
    await stop()
    throw e
  }

  return { baseUrl, dbPath, stop }
}

async function findFreePort(): Promise<number> {
  for (let port = FIRST_TEST_PORT; port < FIRST_TEST_PORT + PORT_SCAN_LIMIT; port++) {
    if (port === DEV_SERVER_PORT) continue
    try {
      const probe = Bun.serve({ port, hostname: "127.0.0.1", fetch: () => new Response("ok") })
      await probe.stop(true)
      return port
    } catch {
      // Taken — try the next one.
    }
  }
  throw new Error(`No free port in ${FIRST_TEST_PORT}..${FIRST_TEST_PORT + PORT_SCAN_LIMIT}`)
}

async function waitUntilReady(baseUrl: string, child: ChildProcess, output: () => string) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Dev server exited during boot (${child.exitCode}):\n${output()}`)
    }
    try {
      const res = await fetch(`${baseUrl}/api/settings`, { signal: AbortSignal.timeout(10_000) })
      if (res.ok) {
        await res.text()
        return
      }
    } catch {
      // Not listening yet, or still compiling.
    }
    await Bun.sleep(250)
  }

  throw new Error(`Dev server not ready after ${BOOT_TIMEOUT_MS}ms:\n${output()}`)
}

/**
 * Compile every route the suite touches, before anything is timed.
 *
 * Turbopack compiles a route on its first request, which can take seconds —
 * longer than the 5s `dispatchCommand` timeout the bridge gives the extension
 * to ack. Without this warm-up a session restore fails not because the code is
 * wrong but because `/api/extension/ack` was still compiling when the first
 * `open` command went out.
 *
 * Every request here is a no-op by design: bad bodies (400) and missing ids
 * (404) compile the module without writing a row.
 */
async function warmUpRoutes(baseUrl: string) {
  const missing = "warmup-no-such-id"
  const post = (path: string, body: unknown) =>
    fetch(baseUrl + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })

  await Promise.all([
    fetch(`${baseUrl}/api/tabs`),
    fetch(`${baseUrl}/api/sessions`),
    fetch(`${baseUrl}/api/groups`),
    fetch(`${baseUrl}/api/chrome/status`),
    fetch(`${baseUrl}/api/sessions/${missing}`),
    fetch(`${baseUrl}/api/groups/${missing}/tabs`),
    post("/api/extension/sync", {}), // 400: missing tabs array
    post("/api/extension/ack", {}), // 400: missing commandId
    post("/api/sessions", {}), // 400: missing name
    post(`/api/sessions/${missing}/restore`, {}), // 404: no such session
  ]).then((responses) => Promise.all(responses.map((r) => r.text())))

  // The SSE route compiles on connect; do it here rather than inside a test.
  const abort = new AbortController()
  await fetch(`${baseUrl}/api/extension/events`, { signal: abort.signal })
  abort.abort()
}

function killGroup(child: ChildProcess, signal: NodeJS.Signals) {
  if (child.pid === undefined) return
  try {
    // Negative pid = the whole process group (we spawned it detached).
    process.kill(-child.pid, signal)
  } catch {
    // Already gone.
  }
}
