import type { ReactNode } from "react";

import { TableCell, TableRow } from "@/ui/table";

export function ProjectTableState({ children, colSpan }: { children: ReactNode; colSpan: number }) {
  return <TableRow className="hover:bg-transparent"><TableCell colSpan={colSpan}><div className="component-fade-in flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">{children}</div></TableCell></TableRow>;
}
