import { describe, expect, it } from "bun:test"
import { captureWithBrowser, type BrowserLike, type RouteLike } from "./browser-capture"

const JPEG = new Uint8Array([0xff, 0xd8, 1, 2])

type Req = { url: string }

/** Fake browser: records lifecycle, lets the test drive requests through the installed route handler. */
function fakeBrowser(opts: {
  navigate?: (url: string, drive: (r: Req) => Promise<"continued" | "aborted">) => Promise<{ status: number } | null>
  screenshotError?: Error
}) {
  const log: string[] = []
  let handler: ((route: RouteLike) => Promise<void>) | null = null
  const drive = async (r: Req) => {
    let out: "continued" | "aborted" | null = null
    await handler!({
      request: () => ({ url: () => r.url }),
      continue: async () => void (out = "continued"),
      abort: async () => void (out = "aborted"),
    })
    return out!
  }
  const browser: BrowserLike = {
    async newContext(o) {
      log.push(`context:${JSON.stringify(o)}`)
      return {
        async route(_p, h) {
          handler = h
        },
        async newPage() {
          return {
            async goto(url: string) {
              if (!opts.navigate) return { status: () => 200 }
              const r = await opts.navigate(url, drive)
              return r && { status: () => r.status }
            },
            async screenshot() {
              if (opts.screenshotError) throw opts.screenshotError
              return JPEG
            },
          }
        },
        async close() {
          log.push("context.close")
        },
      }
    },
    async close() {
      log.push("browser.close")
    },
  }
  return { browser, log }
}

const allowAll = async () => ({ ok: true as const })
const blockPrivate = async (u: string) =>
  u.includes("169.254") || u.includes("10.0.0.1") ? { ok: false as const, reason: "private-address" } : { ok: true as const }

describe("captureWithBrowser", () => {
  it("returns the jpeg and closes context and browser", async () => {
    const f = fakeBrowser({})
    const r = await captureWithBrowser({ launch: async () => f.browser, url: "https://example.com/", checkUrl: allowAll })
    expect(r).toEqual({ ok: true, jpeg: JPEG })
    expect(f.log.slice(-2)).toEqual(["context.close", "browser.close"])
  })

  it("uses a 1280x800 viewport and blocks service workers", async () => {
    const f = fakeBrowser({})
    await captureWithBrowser({ launch: async () => f.browser, url: "https://example.com/", checkUrl: allowAll })
    const o = JSON.parse(f.log[0].replace("context:", ""))
    expect(o.viewport).toEqual({ width: 1280, height: 800 })
    expect(o.serviceWorkers).toBe("block")
  })

  it("re-validates every request via route interception and aborts private targets (redirects, subresources)", async () => {
    const f = fakeBrowser({
      navigate: async (_u, drive) => {
        expect(await drive({ url: "https://example.com/" })).toBe("continued")
        expect(await drive({ url: "http://169.254.169.254/latest/meta-data" })).toBe("aborted")
        expect(await drive({ url: "https://cdn.example.com/a.js" })).toBe("continued")
        return { status: 200 }
      },
    })
    const r = await captureWithBrowser({ launch: async () => f.browser, url: "https://example.com/", checkUrl: blockPrivate })
    expect(r.ok).toBe(true)
  })

  it("fails permanently with the guard reason when a redirect hop of the navigation is blocked", async () => {
    const f = fakeBrowser({
      navigate: async (_u, drive) => {
        await drive({ url: "http://10.0.0.1/admin" }) // redirect target
        throw new Error("net::ERR_FAILED")
      },
    })
    const r = await captureWithBrowser({ launch: async () => f.browser, url: "https://example.com/", checkUrl: blockPrivate })
    expect(r).toEqual({ ok: false, reason: "private-address", retryable: false })
    expect(f.log.slice(-2)).toEqual(["context.close", "browser.close"])
  })

  it("reports a 4xx page as permanent with httpStatus", async () => {
    const f = fakeBrowser({ navigate: async () => ({ status: 404 }) })
    const r = await captureWithBrowser({ launch: async () => f.browser, url: "https://example.com/x", checkUrl: allowAll })
    expect(r).toEqual({ ok: false, reason: "http-404", httpStatus: 404, retryable: false })
  })

  it("treats navigation timeouts and errors as retryable and still closes everything", async () => {
    const f = fakeBrowser({
      navigate: async () => {
        throw new Error("Timeout 30000ms exceeded")
      },
    })
    const r = await captureWithBrowser({ launch: async () => f.browser, url: "https://example.com/", checkUrl: allowAll })
    expect(r).toEqual({ ok: false, reason: "navigation-failed", retryable: true })
    expect(f.log.slice(-2)).toEqual(["context.close", "browser.close"])
  })

  it("closes the browser even if the screenshot throws", async () => {
    const f = fakeBrowser({ screenshotError: new Error("boom") })
    const r = await captureWithBrowser({ launch: async () => f.browser, url: "https://example.com/", checkUrl: allowAll })
    expect(r).toMatchObject({ ok: false, reason: "screenshot-failed", retryable: true })
    expect(f.log.slice(-2)).toEqual(["context.close", "browser.close"])
  })

  it("reports launch failure as retryable", async () => {
    const r = await captureWithBrowser({
      launch: async () => {
        throw new Error("no chromium")
      },
      url: "https://example.com/",
      checkUrl: allowAll,
    })
    expect(r).toEqual({ ok: false, reason: "browser-launch-failed", retryable: true })
  })

  it("closes everything when the hard deadline elapses", async () => {
    const f = fakeBrowser({ navigate: () => new Promise(() => {}) })
    const r = await captureWithBrowser({
      launch: async () => f.browser,
      url: "https://example.com/",
      checkUrl: allowAll,
      deadlineMs: 20,
    })
    expect(r).toEqual({ ok: false, reason: "timeout", retryable: true })
    expect(f.log.slice(-2)).toEqual(["context.close", "browser.close"])
  })
})
