import { useEffect, useState } from "react";

import { isInputMethodComposing } from "@/assets/lib/keyboard";
import { Input } from "@/ui/input";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";

type AppPaginationProps = {
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  page: number;
  pageSize: number;
  pageSizeOptions?: number[];
  totalPages: number;
};

export function AppPagination({ onPageChange, onPageSizeChange, page, pageSize, pageSizeOptions = [20, 50, 100], totalPages }: AppPaginationProps) {
  const safeTotalPages = Math.max(1, totalPages);
  const safePage = Math.min(Math.max(1, page), safeTotalPages);
  const [targetPage, setTargetPage] = useState(String(safePage));
  useEffect(() => { setTargetPage(String(safePage)); }, [safePage]);

  function changePage(nextPage: number) { onPageChange(Math.min(Math.max(1, nextPage), safeTotalPages)); }
  function changePageSize(value: string) { onPageChange(1); onPageSizeChange(Number(value)); }
  function jump() { changePage(Number.isFinite(Number(targetPage)) ? Number(targetPage) : safePage); }

  return <div className="flex flex-wrap items-center justify-end gap-3">
    <Pagination className="mx-0 w-auto justify-end"><PaginationContent>
      <PaginationItem><PaginationPrevious href="#" aria-disabled={safePage <= 1} className={safePage <= 1 ? "pointer-events-none opacity-50" : undefined} onClick={(event) => { event.preventDefault(); changePage(safePage - 1); }} /></PaginationItem>
      {paginationItems(safePage, safeTotalPages).map((item, index) => item === "ellipsis" ? <PaginationItem key={`ellipsis-${index}`}><PaginationEllipsis /></PaginationItem> : <PaginationItem key={item}><PaginationLink href="#" isActive={item === safePage} onClick={(event) => { event.preventDefault(); changePage(item); }}>{item}</PaginationLink></PaginationItem>)}
      <PaginationItem><PaginationNext href="#" aria-disabled={safePage >= safeTotalPages} className={safePage >= safeTotalPages ? "pointer-events-none opacity-50" : undefined} onClick={(event) => { event.preventDefault(); changePage(safePage + 1); }} /></PaginationItem>
    </PaginationContent></Pagination>
    <Select value={String(pageSize)} onValueChange={changePageSize}><SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger><SelectContent>{pageSizeOptions.map((size) => <SelectItem key={size} value={String(size)}>{size}条/页</SelectItem>)}</SelectContent></Select>
    <div className="flex items-center gap-2 whitespace-nowrap text-sm text-muted-foreground"><span>前往</span><Input aria-label="前往页码" className="h-9 w-16 px-2 text-center text-foreground" inputMode="numeric" min={1} max={safeTotalPages} type="number" value={targetPage} onBlur={jump} onChange={(event) => setTargetPage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !isInputMethodComposing(event)) { event.preventDefault(); jump(); } }} /><span>页</span></div>
  </div>;
}

function paginationItems(page: number, totalPages: number): Array<number | "ellipsis"> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, "ellipsis", totalPages];
  if (page >= totalPages - 3) return [1, "ellipsis", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  return [1, "ellipsis", page - 1, page, page + 1, "ellipsis", totalPages];
}
