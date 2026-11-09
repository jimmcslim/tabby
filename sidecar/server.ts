/**
 * Tabby capture sidecar: a tiny HTTP wrapper around Playwright Chromium.
 * Built to a single Node bundle by sidecar/Dockerfile (playwright-core stays
 * external) and run in the official Playwright image. Not imported by the app.
 *
 *   POST /screenshot {"url": "..."}  ->  200 image/jpeg | 422 {ok:false,reason,...}
 *   GET  /health                     ->  200 ok
 *
 * One capture at a time (a queue of waiting requests, one live browser), and
 * every capture runs through captureWithBrowser, which closes its context and
 * browser in `finally`. The same guards the app uses (lib/capture/guards.ts)
 * vet the URL here and every redirect/subresource request the browser makes.
 */
import http from "node:http"
import { captureWithBrowser, type BrowserLike } from "../lib/capture/browser-capture"
import { checkCaptureUrl, loadDenylist } from "../lib/capture/guards"

const PORT = Number.parseInt(process.env.PORT ?? "3002", 10)
const MAX_BODY = 8 * 1024

async function launch(): Promise<BrowserLike> {
  // --no-sandbox: Docker's default seccomp profile blocks Chromium's user-namespace sandbox;
  // isolation comes from the container instead (unprivileged user, cap_drop ALL, no published port).
  // Variable specifier keeps this out of the app's typecheck and the bundle.
  const mod = "playwright-core"
  const { chromium } = (await import(mod)) as { chromium: { launch(o: object): Promise<BrowserLike> } }
  return chromium.launch({ headless: true, args: ["--disable-dev-shm-usage", "--no-sandbox"] })
}

let tail: Promise<unknown> = Promise.resolve()
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn)
  tail = run.catch(() => {})
  return run
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on("data", (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error("too large"))
        req.destroy()
      } else chunks.push(c)
    })
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body))
}

const denylist = loadDenylist()
const checkUrl = (url: string) => checkCaptureUrl(url, { denylist })

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") return void res.writeHead(200).end("ok")
  if (req.method !== "POST" || req.url !== "/screenshot") return void res.writeHead(404).end()

  let url: string
  try {
    const parsed = JSON.parse(await readBody(req)) as { url?: unknown }
    if (typeof parsed.url !== "string") throw new Error("no url")
    url = parsed.url
  } catch {
    return sendJson(res, 400, { ok: false, reason: "bad-request", retryable: false })
  }

  const guard = await checkUrl(url)
  if (!guard.ok) return sendJson(res, 422, { ok: false, reason: guard.reason, retryable: guard.reason === "unresolvable" })

  const result = await serialize(() => captureWithBrowser({ launch, url, checkUrl }))
  if (result.ok) return void res.writeHead(200, { "Content-Type": "image/jpeg" }).end(Buffer.from(result.jpeg))
  sendJson(res, 422, result)
})

server.listen(PORT, "0.0.0.0", () => console.log(`capture sidecar listening on :${PORT}`))
