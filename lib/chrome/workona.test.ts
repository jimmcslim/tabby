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
})
