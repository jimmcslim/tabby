// Workona's tab suspender parks tabs at workona.com/redirect/ with the
// original url/title/favicon URL-encoded in the hash fragment.
export function unwrapWorkonaUrl(
  rawUrl: string,
): { url: string; title?: string; faviconUrl?: string } | null {
  try {
    const u = new URL(rawUrl)
    // Exact host or a subdomain of it — a bare endsWith would also accept
    // lookalikes like notworkona.com, letting any site restate a tab's url.
    const isWorkona = u.hostname === "workona.com" || u.hostname.endsWith(".workona.com")
    if (!isWorkona || !u.hash) return null
    const params = new URLSearchParams(u.hash.slice(1))
    const url = params.get("url")
    if (!url || !/^https?:\/\//i.test(url)) return null
    return {
      url,
      title: params.get("title") || undefined,
      faviconUrl: params.get("favIconUrl") || undefined,
    }
  } catch {
    return null
  }
}
