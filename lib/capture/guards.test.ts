import { describe, expect, it } from "bun:test"
import { checkCaptureUrl, domainRoot, isPrivateIp } from "./guards"

const publicDns = async () => ["93.184.216.34"]
const noDns = async () => {
  throw new Error("should not resolve")
}

describe("isPrivateIp", () => {
  it("flags loopback, private, link-local and unspecified addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "192.168.0.5",
      "172.16.0.1",
      "172.31.255.1",
      "169.254.169.254",
      "0.0.0.0",
      "100.64.0.1",
      "::1",
      "fe80::1",
      "fc00::1",
      "::ffff:10.0.0.1",
    ]) {
      expect(isPrivateIp(ip)).toBe(true)
    }
  })
  it("allows public addresses", () => {
    for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:2800:220:1::1"]) {
      expect(isPrivateIp(ip)).toBe(false)
    }
  })
})

describe("checkCaptureUrl", () => {
  const opts = { denylist: [], resolve: publicDns }

  it("accepts a public https url", async () => {
    expect(await checkCaptureUrl("https://example.com/a", opts)).toEqual({ ok: true })
  })
  it("rejects non-http(s) schemes", async () => {
    for (const u of ["file:///etc/passwd", "chrome://settings", "ftp://x.com/", "javascript:alert(1)", "not a url"]) {
      expect((await checkCaptureUrl(u, opts)).ok).toBe(false)
    }
  })
  it("rejects credentials in the url", async () => {
    expect((await checkCaptureUrl("https://u:p@example.com/", opts)).ok).toBe(false)
  })
  it("rejects private literal hosts and internal names without resolving", async () => {
    for (const u of [
      "http://localhost:3000/",
      "http://127.0.0.1/",
      "http://[::1]/",
      "http://192.168.1.1/",
      "http://nas/",
      "http://printer.local/",
      "http://x.internal/",
      "http://router.lan/",
    ]) {
      expect((await checkCaptureUrl(u, { denylist: [], resolve: noDns })).ok).toBe(false)
    }
  })
  it("rejects hostnames that resolve to a private address", async () => {
    const r = await checkCaptureUrl("https://sneaky.example.com/", {
      denylist: [],
      resolve: async () => ["93.184.216.34", "10.0.0.7"],
    })
    expect(r).toEqual({ ok: false, reason: "private-address" })
  })
  it("rejects hostnames that do not resolve", async () => {
    const r = await checkCaptureUrl("https://nx.example.com/", {
      denylist: [],
      resolve: async () => {
        throw new Error("ENOTFOUND")
      },
    })
    expect(r.ok).toBe(false)
  })
  it("honours the denylist for the domain and its subdomains only", async () => {
    const o = { denylist: ["mybank.com"], resolve: publicDns }
    expect((await checkCaptureUrl("https://mybank.com/", o)).ok).toBe(false)
    expect((await checkCaptureUrl("https://secure.mybank.com/x", o)).ok).toBe(false)
    expect((await checkCaptureUrl("https://notmybank.com/", o)).ok).toBe(true)
  })
  it("denies built-in banking and mail hosts by default", async () => {
    expect((await checkCaptureUrl("https://mail.google.com/mail/u/0/", { resolve: publicDns })).ok).toBe(false)
    expect((await checkCaptureUrl("https://www.paypal.com/", { resolve: publicDns })).ok).toBe(false)
  })
})

describe("domainRoot", () => {
  it("returns scheme://host/ and drops path, query and fragment", () => {
    expect(domainRoot("https://example.com/a/b?c=1#d")).toBe("https://example.com/")
    expect(domainRoot("http://example.com:8080/x")).toBe("http://example.com:8080/")
  })
  it("returns null when the url already is the root", () => {
    expect(domainRoot("https://example.com/")).toBeNull()
    expect(domainRoot("https://example.com/?q=1")).toBeNull()
    expect(domainRoot("https://example.com")).toBeNull()
  })
})
