import { afterEach, describe, expect, it } from "bun:test"
import { isEnrichmentDisabled } from "./enrichment"

const original = process.env.TABBY_DISABLE_ENRICHMENT

afterEach(() => {
  if (original === undefined) delete process.env.TABBY_DISABLE_ENRICHMENT
  else process.env.TABBY_DISABLE_ENRICHMENT = original
})

describe("isEnrichmentDisabled", () => {
  it("is off unless the flag is explicitly set", () => {
    delete process.env.TABBY_DISABLE_ENRICHMENT
    expect(isEnrichmentDisabled()).toBe(false)
  })

  it("accepts 1 and true", () => {
    process.env.TABBY_DISABLE_ENRICHMENT = "1"
    expect(isEnrichmentDisabled()).toBe(true)
    process.env.TABBY_DISABLE_ENRICHMENT = "true"
    expect(isEnrichmentDisabled()).toBe(true)
  })

  it("treats anything else as unset, so a stray value can't silently disable enrichment", () => {
    for (const value of ["0", "false", "", "yes"]) {
      process.env.TABBY_DISABLE_ENRICHMENT = value
      expect(isEnrichmentDisabled()).toBe(false)
    }
  })
})
