import fs from "node:fs"
import path from "node:path"

const SCREENSHOT_DIR = path.join(process.cwd(), "data", "screenshots")

export function ensureScreenshotDir(): void {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
  }
}

/** Cache path for a tab's preview, keyed by the DB tab id */
export function screenshotPath(tabId: string): string {
  return path.join(SCREENSHOT_DIR, `${tabId}.jpg`)
}
