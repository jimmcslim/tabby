import { describe, expect, it } from "bun:test"
import { createSidecarBackend } from "./playwright"

const IMG = new Uint8Array([9, 8, 7])
function setup(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const requests: { url: string; init?: RequestInit }[] = []
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init })
    return handler(String(url), init)
  }) as typeof fetch
  return { backend: createSidecarBackend({ baseUrl: "http://sidecar:3002/", fetch: fetchFn }), requests }
}

describe("createSidecarBackend", () => {
  it("POSTs the url to /screenshot and returns the jpeg bytes", async () => {
    const { backend, requests } = setup(() => new Response(IMG, { headers: { "content-type": "image/jpeg" } }))
    expect(backend.name).toBe("playwright-sidecar")
    expect(await backend.captureScreenshot("https://example.com/p")).toEqual({ ok: true, jpeg: IMG })
    expect(requests[0].url).toBe("http://sidecar:3002/screenshot")
    expect(requests[0].init?.method).toBe("POST")
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({ url: "https://example.com/p" })
  })

  it("passes through the sidecar's structured failure", async () => {
    const body = { ok: false, reason: "http-404", httpStatus: 404, retryable: false }
    const { backend } = setup(() => Response.json(body, { status: 422 }))
    expect(await backend.captureScreenshot("https://example.com/x")).toEqual({
      ok: false,
      reason: "http-404",
      httpStatus: 404,
      retryable: false,
    })
  })

  it("treats unreachable sidecar and unexpected responses as retryable", async () => {
    const down = setup(() => {
      throw new Error("ECONNREFUSED")
    })
    expect(await down.backend.captureScreenshot("https://example.com/")).toEqual({
      ok: false,
      reason: "sidecar-unreachable",
      retryable: true,
    })
    const bad = setup(() => new Response("oops", { status: 502 }))
    expect(await bad.backend.captureScreenshot("https://example.com/")).toEqual({
      ok: false,
      reason: "sidecar-error",
      retryable: true,
    })
  })
})
