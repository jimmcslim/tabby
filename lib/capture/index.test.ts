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

describe("resolveDrainLimit", () => {
  it("defaults to 15 and accepts CAPTURE_DRAIN_LIMIT", () => {
    expect(resolveDrainLimit({})).toBe(15)
    expect(resolveDrainLimit({ CAPTURE_DRAIN_LIMIT: "5" })).toBe(5)
    expect(resolveDrainLimit({ CAPTURE_DRAIN_LIMIT: "abc" })).toBe(15)
    expect(resolveDrainLimit({ CAPTURE_DRAIN_LIMIT: "0" })).toBe(15)
  })
})
