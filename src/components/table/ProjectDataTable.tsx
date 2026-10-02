import {
  columnSizingFeature,
  createColumnHelper,
  functionalUpdate,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type SortingState,
  type Updater
} from "@tanstack/react-table";
import { ArrowUp, ArrowUpDown, Inbox, Search, X } from "lucide-react";
import { type CSSProperties, type MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/assets/lib/utils";
import { AppPagination } from "@/components/bar/AppPagination";
import { ProjectTableState } from "@/components/table/ProjectTableState";
import { Button } from "@/ui/button";
import { Card, CardContent } from "@/ui/card";
import { Input } from "@/ui/input";
import { Skeleton } from "@/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import type { ProjectSortOrder } from "@/types/table";

const projectTableFeatures = tableFeatures({ columnSizingFeature, rowSortingFeature });
const interactiveRowSelector = "a, button, input, select, textarea, label, summary, audio[controls], video[controls], [contenteditable]:not([contenteditable='false']), [tabindex], [role='button'], [role='link'], [role='checkbox'], [role='radio'], [role='switch'], [role='combobox'], [role='menuitem']";

export type ProjectTableColumn<TData, TSort extends string> = {
  align?: "left" | "right";
  cell?: (row: TData, href: string) => ReactNode;
  className?: string;
  id: TSort | "actions";
  label: string;
  size: number;
  sortKey?: TSort;
  value: (row: TData) => unknown;
};

type ProjectDataTableProps<TData extends { id: number | string }, TSort extends string> = {
  columns: ProjectTableColumn<TData, TSort>[];
  emptyMessage: string;
  loading: boolean;
  filters?: ReactNode;
  onOpen: (row: TData) => void;
  pagination: {
    onPageChange: (page: number) => void;
    onPageSizeChange: (pageSize: number) => void;
    page: number;
    pageSize: number;
    total: number;
  };
  rows: TData[];
  rowHref: (row: TData) => string;
  search: {
    label?: string;
    onChange: (value: string) => void;
    placeholder: string;
    value: string;
  };
  sorting: {
    field: TSort;
    onChange: (field: TSort, order: ProjectSortOrder) => void;
    order: ProjectSortOrder;
  };
};

export default function ProjectDataTable<TData extends { id: number | string }, TSort extends string>({ columns, emptyMessage, filters, loading, onOpen, pagination, rows, rowHref, search, sorting }: ProjectDataTableProps<TData, TSort>) {
  const [searchInput, setSearchInput] = useState(search.value);
  const pendingSearch = useRef<string | null>(null);
  const previousSearch = useRef(search.value);
  const sortingState = useMemo<SortingState>(() => [{ id: sorting.field, desc: sorting.order === "desc" }], [sorting.field, sorting.order]);
  const columnById = useMemo(() => Object.fromEntries(columns.map((column) => [column.id, column])) as Record<string, ProjectTableColumn<TData, TSort>>, [columns]);
  const helper = useMemo(() => createColumnHelper<typeof projectTableFeatures, TData>(), []);
  const definitions = useMemo(() => helper.columns(columns.map((column) => helper.accessor(column.value, {
    id: column.id,
    header: column.label,
    cell: (context) => column.cell ? column.cell(context.row.original, rowHref(context.row.original)) : renderValue(context.getValue()),
    enableSorting: column.sortKey !== undefined,
    size: column.size
  }))), [columns, helper, rowHref]);

  useEffect(() => {
    if (search.value !== previousSearch.current) {
      previousSearch.current = search.value;
      const ownEcho = search.value === pendingSearch.current;
      pendingSearch.current = null;
      // A normalized echo must not remove spaces or newer typing from the draft.
      if (!ownEcho) {
        setSearchInput(search.value);
        return undefined;
      }
    }
    const normalized = searchInput.trim();
    if (normalized === search.value) return undefined;
    const timer = window.setTimeout(() => {
      pendingSearch.current = normalized;
      search.onChange(normalized);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search.onChange, search.value, searchInput]);

  const updateSorting = useCallback((updater: Updater<SortingState>) => {
    const next = functionalUpdate(updater, sortingState)[0];
    if (!next) return;
    const sortKey = columnById[next.id]?.sortKey;
    if (sortKey) sorting.onChange(sortKey, next.desc ? "desc" : "asc");
  }, [columnById, sorting, sortingState]);

  const table = useTable({
    columns: definitions,
    data: rows,
    enableSortingRemoval: false,
    features: projectTableFeatures,
    getRowId: (row) => String(row.id),
    manualSorting: true,
    onSortingChange: updateSorting,
    state: { sorting: sortingState }
  });
  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
  const totalColumnSize = columns.reduce((total, column) => total + column.size, 0);

  function clearSearch() {
    setSearchInput("");
    pendingSearch.current = "";
    search.onChange("");
  }

  function openWithPointer(event: MouseEvent<HTMLTableRowElement>, row: TData) {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const interactiveTarget = (event.target as Element).closest?.(interactiveRowSelector);
    if (interactiveTarget && interactiveTarget !== event.currentTarget) return;
    onOpen(row);
  }

  return <Card className="gap-0 overflow-hidden rounded-lg py-0 shadow-sm"><CardContent className="p-0">
    <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
      <div className="relative w-full max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input aria-label={search.label ?? "搜索项目"} className="pr-9 pl-9" placeholder={search.placeholder} value={searchInput} onChange={(event) => setSearchInput(event.target.value)} />
        {searchInput ? <Button aria-label="清空搜索" className="absolute right-1 top-1/2 -translate-y-1/2" size="icon-sm" variant="ghost" onClick={clearSearch}><X /></Button> : null}
      </div>
      {filters}
    </div>
    <Table className="table-fixed" containerClassName="overflow-y-hidden">
      <colgroup>{columns.map((column) => <col key={column.id} style={{ width: `${column.size / totalColumnSize * 100}%` }} />)}</colgroup>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => <TableRow key={headerGroup.id}>{headerGroup.headers.map((header) => {
          const config = columnById[header.column.id];
          const sorted = header.column.getIsSorted();
          let content: ReactNode = null;
          if (!header.isPlaceholder) content = header.column.getCanSort()
            ? <div className={cn("flex w-full items-center gap-1 py-2", config.align === "right" && "justify-end")}>
                <button className="group/sort inline-flex min-w-0 cursor-pointer items-center gap-1.5 text-left transition-colors hover:text-foreground" title={`按${config.label}排序`} onClick={header.column.getToggleSortingHandler()}><span className="truncate">{config.label}</span>{sortingIcon(sorted)}</button>
              </div>
            : <div className={cn("py-2", config.align === "right" && "text-right")}>{config.label}</div>;
          return <TableHead aria-sort={ariaSortValue(sorted)} className={cn("px-3", config.align === "right" && "text-right")} key={header.id}>{content}</TableHead>;
        })}</TableRow>)}
      </TableHeader>
      <TableBody key={`${pagination.page}:${pagination.pageSize}:${sorting.field}:${sorting.order}`}>
        {loading ? Array.from({ length: 5 }, (_, index) => <TableRow key={`skeleton-${index}`} className="hover:bg-transparent">{columns.map((column) => <TableCell className="px-3 py-4" key={column.id}><Skeleton className={cn("h-4", column.align === "right" ? "ml-auto w-8" : "w-3/4")} /></TableCell>)}</TableRow>) : null}
        {!loading && table.getRowModel().rows.map((row, index) => <TableRow className="table-row-enter group cursor-pointer" key={row.id} style={{ "--row-index": Math.min(index, 12) } as CSSProperties} onClick={(event) => openWithPointer(event, row.original)}>{row.getAllCells().map((cell) => {
          const config = columnById[cell.column.id];
          return <TableCell className={cn("px-3 py-4", config.align === "right" && "text-right", config.className)} key={cell.id}><table.FlexRender cell={cell} /></TableCell>;
        })}</TableRow>)}
        {!loading && !rows.length ? <ProjectTableState colSpan={columns.length}><Inbox className="size-4" />{search.value ? "没有符合搜索条件的记录" : emptyMessage}</ProjectTableState> : null}
      </TableBody>
    </Table>
    <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><span className="text-xs text-muted-foreground">共 {pagination.total.toLocaleString("zh-CN")} 条</span><AppPagination page={pagination.page} pageSize={pagination.pageSize} totalPages={totalPages} onPageChange={pagination.onPageChange} onPageSizeChange={pagination.onPageSizeChange} /></div>
  </CardContent></Card>;
}

function renderValue(value: unknown): ReactNode {
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground">—</span>;
  return String(value);
}

function ariaSortValue(sorted: false | "asc" | "desc"): "none" | "ascending" | "descending" {
  if (sorted === "asc") return "ascending";
  if (sorted === "desc") return "descending";
  return "none";
}

function sortingIcon(sorted: false | "asc" | "desc") {
  if (!sorted) return <ArrowUpDown className="size-3.5 shrink-0 text-muted-foreground opacity-60 transition-opacity group-hover/sort:opacity-100" />;
  return <ArrowUp className={cn("size-3.5 shrink-0 text-primary transition-transform duration-200", sorted === "desc" && "rotate-180")} />;
}
