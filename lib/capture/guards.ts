import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

/**
 * Backend-agnostic guards for server-side capture: scheme/SSRF check and the
 * domain denylist. Every CaptureBackend sits behind these (see drain.ts).
 */

/** Hosts a server-side capture must never see (banking, mail). Subdomains match too. */
export const DEFAULT_DENYLIST = [
  "mail.google.com",
  "outlook.live.com",
  "outlook.office.com",
  "outlook.office365.com",
  "mail.yahoo.com",
  "mail.proton.me",
  "proton.me",
  "fastmail.com",
  "icloud.com",
  "paypal.com",
  "chase.com",
  "bankofamerica.com",
  "wellsfargo.com",
  "citi.com",
  "capitalone.com",
  "americanexpress.com",
  "hsbc.com",
  "barclays.co.uk",
  "lloydsbank.com",
  "natwest.com",
  "commbank.com.au",
  "anz.com",
  "westpac.com.au",
  "nab.com.au",
]

/** Denylist = built-in defaults + CAPTURE_DENYLIST (comma-separated domains). */
export function loadDenylist(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = (env.CAPTURE_DENYLIST ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean)
  return [...DEFAULT_DENYLIST, ...extra]
}

export function isPrivateIp(ip: string): boolean {
  const lower = ip.toLowerCase()
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateIp(mapped[1])
  if (isIP(lower) === 4) {
    const [a, b] = lower.split(".").map(Number)
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    )
  }
  if (isIP(lower) === 6) {
    return (
      lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      /^fe[89ab]/.test(lower)
    )
  }
  return false
}

type Resolve = (hostname: string) => Promise<string[]>

const defaultResolve: Resolve = async (hostname) => {
  const records = await lookup(hostname, { all: true })
  return records.map((r) => r.address)
}

export type GuardResult = { ok: true } | { ok: false; reason: string }

export async function checkCaptureUrl(
  rawUrl: string,
  opts: { denylist?: string[]; resolve?: Resolve } = {},
): Promise<GuardResult> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, reason: "invalid-url" }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "scheme" }
  if (url.username || url.password) return { ok: false, reason: "credentials" }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "")
  if (!host) return { ok: false, reason: "invalid-url" }

  const denylist = opts.denylist ?? loadDenylist()
  if (denylist.some((d) => host === d || host.endsWith(`.${d}`))) {
    return { ok: false, reason: "denylisted" }
  }

  if (isIP(host)) {
    return isPrivateIp(host) ? { ok: false, reason: "private-address" } : { ok: true }
  }
  // Single-label names and internal suffixes never resolve publicly.
  if (
    !host.includes(".") ||
    host === "localhost" ||
    /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(host)
  ) {
    return { ok: false, reason: "internal-host" }
  }

  let addresses: string[]
  try {
    addresses = await (opts.resolve ?? defaultResolve)(host)
  } catch {
    return { ok: false, reason: "unresolvable" }
  }
  if (addresses.length === 0) return { ok: false, reason: "unresolvable" }
  if (addresses.some(isPrivateIp)) return { ok: false, reason: "private-address" }
  return { ok: true }
}

/** scheme://host[:port]/ for a URL, or null if the URL already is the root (or invalid). */
export function domainRoot(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    const root = `${url.protocol}//${url.host}/`
    return url.pathname === "/" ? null : root
  } catch {
    return null
  }
}
