"use client"

import { useCallback, useState } from "react"
import { useSyncContext } from "@/components/providers/sync-provider"
import { Header } from "@/components/layout/header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { HugeiconsIcon } from "@hugeicons/react"
import { CheckmarkCircle01Icon, Cancel01Icon } from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"

export default function SettingsPage() {
  const { chromeStatus } = useSyncContext()

  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434")
  const [ollamaTestResult, setOllamaTestResult] = useState<boolean | null>(null)

  const extension = chromeStatus?.extension

  const testOllama = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/status")
      const data = await res.json()
      setOllamaTestResult(data.connected)
    } catch {
      setOllamaTestResult(false)
    }
  }, [])

  return (
    <>
      <Header title="Settings" searchValue="" onSearchChange={() => {}} />

      <div className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-2xl space-y-8">
          {/* Chrome Extension */}
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Chrome Extension</h2>
              <p className="text-sm text-muted-foreground">
                The Tabby Connector extension provides tab state, tab actions, and previews.
              </p>
            </div>

            <div className="space-y-2 rounded-lg border bg-muted/50 p-4 text-sm">
              <div className="flex items-center gap-2">
                <HugeiconsIcon
                  icon={extension?.connected ? CheckmarkCircle01Icon : Cancel01Icon}
                  className={cn("size-4", extension?.connected ? "text-green-500" : "text-red-500")}
                />
                <span>{extension?.connected ? "Extension connected" : "Extension not connected"}</span>
              </div>
              <dl className="ml-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <dt>Command stream</dt>
                <dd>{extension?.sse ? "live" : "reconnecting"}</dd>
                <dt>Version</dt>
                <dd>{extension?.version ?? "—"}</dd>
                <dt>Last report</dt>
                <dd>{extension?.lastReportAt ? new Date(extension.lastReportAt).toLocaleString() : "never"}</dd>
              </dl>
            </div>

            {!extension?.connected && (
              <div className="rounded-lg border bg-muted/50 p-4">
                <h3 className="mb-2 text-sm font-medium">How to install</h3>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  <li>Open <code className="rounded bg-background px-1.5 py-0.5">chrome://extensions</code> and enable Developer mode</li>
                  <li>Click &ldquo;Load unpacked&rdquo; and select the <code className="rounded bg-background px-1.5 py-0.5">extension/</code> folder of this repo</li>
                  <li>Tabby connects automatically within a few seconds</li>
                </ol>
              </div>
            )}
          </section>

          <Separator />

          {/* Ollama */}
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Ollama (AI Features)</h2>
              <p className="text-sm text-muted-foreground">
                Connect to Ollama for tab classification, summarization, and smart grouping.
              </p>
            </div>

            <div className="flex items-end gap-3">
              <div className="flex-1 space-y-1.5">
                <label className="text-sm font-medium">Ollama URL</label>
                <Input
                  value={ollamaUrl}
                  onChange={(e) => setOllamaUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                />
              </div>
              <Button variant="outline" onClick={testOllama}>
                Test Connection
              </Button>
            </div>

            {ollamaTestResult !== null && (
              <div className="flex items-center gap-2 text-sm">
                <HugeiconsIcon
                  icon={ollamaTestResult ? CheckmarkCircle01Icon : Cancel01Icon}
                  className={cn("size-4", ollamaTestResult ? "text-green-500" : "text-red-500")}
                />
                <span>{ollamaTestResult ? "Connected successfully" : "Connection failed"}</span>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  )
}
