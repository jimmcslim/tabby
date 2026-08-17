import { describe, expect, it } from "bun:test"
import { unwrapWorkonaUrl } from "./workona"

describe("unwrapWorkonaUrl", () => {
  it("unwraps a parked tab's url, title and favicon", () => {
    const parked =
      "https://workona.com/redirect/#url=https%3A%2F%2Fexample.com%2Fpost&title=A%20Post&favIconUrl=https%3A%2F%2Fexample.com%2Ficon.png"

    expect(unwrapWorkonaUrl(parked)).toEqual({
      url: "https://example.com/post",
      title: "A Post",
      faviconUrl: "https://example.com/icon.png",
    })
  })

  it("returns null for urls that aren't parked by Workona", () => {
    expect(unwrapWorkonaUrl("https://example.com/post")).toBeNull()
    expect(unwrapWorkonaUrl("https://workona.com/redirect/")).toBeNull()
    expect(unwrapWorkonaUrl("not a url")).toBeNull()
  })

  it("rejects a hash url that isn't http(s)", () => {
    expect(unwrapWorkonaUrl("https://workona.com/redirect/#url=javascript%3Aalert(1)")).toBeNull()
  })

  it("unwraps from any workona.com subdomain", () => {
    expect(
      unwrapWorkonaUrl("https://app.workona.com/redirect/#url=https%3A%2F%2Fexample.com%2F"),
    ).toEqual({ url: "https://example.com/", title: undefined, faviconUrl: undefined })
  })

  it("leaves title and favicon undefined when the hash omits them", () => {
    expect(unwrapWorkonaUrl("https://workona.com/redirect/#url=https%3A%2F%2Fexample.com%2F")).toEqual(
      { url: "https://example.com/", title: undefined, faviconUrl: undefined },
    )
  })

  it("returns null when the hash carries no url", () => {
    expect(unwrapWorkonaUrl("https://workona.com/redirect/#title=Just%20A%20Title")).toBeNull()
  })

  it("is not fooled by a lookalike host", () => {
    expect(
      unwrapWorkonaUrl("https://notworkona.com/redirect/#url=https%3A%2F%2Fexample.com%2F"),
    ).toBeNull()
  })
})
