"use client"

import { useEffect, useRef, useState } from "react"
import type { TabGroup } from "@/lib/tabs/grouping"
import { HugeiconsIcon } from "@hugeicons/react"
import { PencilEdit01Icon } from "@hugeicons/core-free-icons"

export function EditableGroupHeader({
  group,
  onRename,
}: {
  group: TabGroup
  onRename: (windowId: string, name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(group.label)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setValue(group.label)
  }, [group.label])

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const commit = () => {
    setEditing(false)
    const trimmed = value.trim()
    if (trimmed && trimmed !== group.label) {
      onRename(group.key, trimmed)
    } else {
      setValue(group.label)
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="bg-transparent text-sm font-medium text-muted-foreground outline-none border-b border-muted-foreground/30 focus:border-foreground"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit()
          if (e.key === "Escape") {
            setValue(group.label)
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <button
      className="group/rename flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      onClick={() => setEditing(true)}
    >
      {group.label}
      <HugeiconsIcon
        icon={PencilEdit01Icon}
        className="size-3 opacity-0 group-hover/rename:opacity-60 transition-opacity"
      />
    </button>
  )
}
