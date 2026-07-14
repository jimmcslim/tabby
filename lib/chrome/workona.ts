// Workona's tab suspender parks tabs at workona.com/redirect/ with the
// original url/title/favicon URL-encoded in the hash fragment.
export function unwrapWorkonaUrl(
  rawUrl: string,
): { url: string; title?: string; faviconUrl?: string } | null {
  try {
    const u = new URL(rawUrl)
    if (!u.hostname.endsWith("workona.com") || !u.hash) return null
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
