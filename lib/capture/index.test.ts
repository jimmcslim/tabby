import { describe, expect, it } from "bun:test"
import { resolveCaptureBackend, resolveDrainLimit } from "./index"

describe("resolveCaptureBackend", () => {
  it("is off by default", () => {
    expect(resolveCaptureBackend({})).toBeNull()
    expect(resolveCaptureBackend({ FIRECRAWL_API_KEY: "  " })).toBeNull()
  })
  it("selects hosted Firecrawl when FIRECRAWL_API_KEY is set", () => {
    expect(resolveCaptureBackend({ FIRECRAWL_API_KEY: "fc-1" })?.name).toBe("firecrawl")
  })
  it("is suppressed when enrichment is disabled", () => {
    expect(resolveCaptureBackend({ FIRECRAWL_API_KEY: "fc-1", TABBY_DISABLE_ENRICHMENT: "1" })).toBeNull()
  })
})

describe("resolveCaptureBackend selection by CAPTURE_BACKEND", () => {
  it("selects the sidecar (default or custom URL) only when asked", () => {
    expect(resolveCaptureBackend({ CAPTURE_BACKEND: "sidecar" })?.name).toBe("playwright-sidecar")
    expect(resolveCaptureBackend({ CAPTURE_BACKEND: "sidecar", CAPTURE_SIDECAR_URL: "http://x:1" })?.name).toBe("playwright-sidecar")
  })
  it("explicit hosted needs a key; explicit none wins over a key", () => {
    expect(resolveCaptureBackend({ CAPTURE_BACKEND: "hosted" })).toBeNull()
    expect(resolveCaptureBackend({ CAPTURE_BACKEND: "hosted", FIRECRAWL_API_KEY: "fc-1" })?.name).toBe("firecrawl")
    expect(resolveCaptureBackend({ CAPTURE_BACKEND: "none", FIRECRAWL_API_KEY: "fc-1" })).toBeNull()
  })
  it("sidecar is suppressed when enrichment is disabled; unknown values are off", () => {
    expect(resolveCaptureBackend({ CAPTURE_BACKEND: "sidecar", TABBY_DISABLE_ENRICHMENT: "1" })).toBeNull()
    expect(resolveCaptureBackend({ CAPTURE_BACKEND: "bogus", FIRECRAWL_API_KEY: "fc-1" })).toBeNull()
  })
})

describe("resolveDrainLimit", () => {
  it("defaults to 15 and accepts CAPTURE_DRAIN_LIMIT", () => {
    expect(resolveDrainLimit({})).toBe(15)
    expect(resolveDrainLimit({ CAPTURE_DRAIN_LIMIT: "5" })).toBe(5)
    expect(resolveDrainLimit({ CAPTURE_DRAIN_LIMIT: "abc" })).toBe(15)
    expect(resolveDrainLimit({ CAPTURE_DRAIN_LIMIT: "0" })).toBe(15)
  })
})
