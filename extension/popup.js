const dot = document.getElementById("dot")
const statusEl = document.getElementById("status")
const detailEl = document.getElementById("detail")
const baseUrlInput = document.getElementById("baseUrl")
const syncBtn = document.getElementById("sync")

async function getBaseUrl() {
  const { baseUrl } = await chrome.storage.local.get({ baseUrl: "http://localhost:3000" })
  return baseUrl.replace(/\/+$/, "")
}

async function refresh() {
  const baseUrl = await getBaseUrl()
  baseUrlInput.value = baseUrl

  const sw = await chrome.runtime.sendMessage({ type: "status" }).catch(() => null)

  try {
    const res = await fetch(baseUrl + "/api/chrome/status")
    const status = await res.json()
    if (status.source === "extension") {
      dot.className = "dot ok"
      statusEl.textContent = "Connected (extension)"
    } else {
      dot.className = "dot bad"
      statusEl.textContent = "Server up, source: " + (status.source || "unknown")
    }
    detailEl.textContent = sw?.sseConnected ? "Command stream: live" : "Command stream: reconnecting…"
  } catch {
    dot.className = "dot bad"
    statusEl.textContent = "Tabby server unreachable"
    detailEl.textContent = ""
  }
}

baseUrlInput.addEventListener("change", async () => {
  const value = baseUrlInput.value.trim().replace(/\/+$/, "") || "http://localhost:3000"
  await chrome.storage.local.set({ baseUrl: value })
  refresh()
})

syncBtn.addEventListener("click", async () => {
  syncBtn.textContent = "Syncing…"
  const res = await chrome.runtime.sendMessage({ type: "sync-now" }).catch(() => null)
  syncBtn.textContent = "Sync now"
  if (res?.result) {
    detailEl.textContent = `Synced: +${res.result.added} ~${res.result.updated} -${res.result.closed} (${res.result.total} tabs)`
  }
  refresh()
})

refresh()
