import type { ComponentProps } from "react"

import { Badge } from "@/ui/badge"
import { cn } from "@/assets/lib/utils"

type StatusTone = "blue" | "green" | "amber" | "red" | "neutral"

const toneClasses: Record<StatusTone, string> = {
  blue: "border-sky-500/35 bg-sky-500/15 text-sky-700 dark:text-sky-300",
  green: "border-emerald-500/35 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  amber: "border-amber-500/35 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  red: "border-red-500/35 bg-red-500/15 text-red-700 dark:text-red-300",
  neutral: "border-border bg-muted text-muted-foreground"
}

export function StatusBadge({
  tone,
  className,
  ...props
}: ComponentProps<typeof Badge> & { tone: StatusTone }) {
  return <Badge variant="outline" className={cn(toneClasses[tone], className)} {...props} />
}
