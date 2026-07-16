"use client"

import { Slider } from "@/components/ui/slider"
import { HugeiconsIcon } from "@hugeicons/react"
import { MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons"

interface CardZoomControlProps {
  visible: boolean
  /** Cards per row: 4 (max zoom in) to 12 (max zoom out) */
  value: number
  onChange: (cols: number) => void
}

export function CardZoomControl({ visible, value, onChange }: CardZoomControlProps) {
  if (!visible) return null

  return (
    <div className="fixed bottom-6 right-8 z-40 flex items-center gap-2.5 rounded-full border bg-background/80 py-2 pl-3.5 pr-4 shadow-lg backdrop-blur-md">
      <button
        className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        onClick={() => onChange(Math.min(value + 1, 12))}
        disabled={value >= 12}
        title="Zoom out"
        aria-label="Zoom out"
      >
        <HugeiconsIcon icon={MinusSignIcon} className="size-3.5" />
      </button>
      <div className="w-64">
        <Slider
          aria-label="Card zoom"
          min={8}
          max={16}
          step={1}
          // Inverted: slider right = zoom in (fewer, larger cards).
          // cols = 20 - value, so 16 -> 4 cols (default), 8 -> 12 cols.
          value={[20 - value]}
          onValueChange={(v) => {
            const single = Array.isArray(v) ? v[0] : v
            onChange(20 - single)
          }}
        />
      </div>
      <button
        className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        onClick={() => onChange(Math.max(value - 1, 4))}
        disabled={value <= 4}
        title="Zoom in"
        aria-label="Zoom in"
      >
        <HugeiconsIcon icon={PlusSignIcon} className="size-3.5" />
      </button>
    </div>
  )
}
