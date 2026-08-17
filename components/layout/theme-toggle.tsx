"use client"

import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { useHydrated } from "@/hooks/use-hydrated"
import { HugeiconsIcon } from "@hugeicons/react"
import { Sun03Icon, Moon02Icon } from "@hugeicons/core-free-icons"

export function ThemeToggle() {
  const mounted = useHydrated()
  const { resolvedTheme, setTheme } = useTheme()

  if (!mounted) return <div className="size-8" />

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      title={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} mode`}
    >
      <HugeiconsIcon
        icon={resolvedTheme === "dark" ? Sun03Icon : Moon02Icon}
        className="size-4"
      />
    </Button>
  )
}
