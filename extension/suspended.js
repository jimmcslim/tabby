// Placeholder shown for a "suspended" restored tab — mimics Chrome's native
// lazy session restore: paint the saved title/favicon, do nothing else until
// the tab is actually made visible, then navigate to the real URL.

const params = new URLSearchParams(location.search)
const realUrl = params.get("u") || ""
const title = params.get("t") || realUrl
const favicon = params.get("f") || ""

document.title = title
document.getElementById("label").textContent = title
if (favicon) {
  document.getElementById("favicon").href = favicon
  document.getElementById("icon").src = favicon
}

let loaded = false
function load() {
  if (loaded || !realUrl) return
  loaded = true
  location.replace(realUrl)
}

if (document.visibilityState === "visible") {
  load()
} else {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") load()
  })
}
