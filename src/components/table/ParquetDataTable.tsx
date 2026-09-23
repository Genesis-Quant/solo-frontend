import {
  cellSpanningFeature,
  columnFilteringFeature,
  columnOrderingFeature,
  columnPinningFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  constructFilterFn,
  filterFn_includesString,
  filterFn_weakEquals,
  functionalUpdate,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  tableFeatures,
  useTable,
  type ColumnFiltersState,
  type ColumnOrderState,
  type ColumnPinningState,
  type PaginationState,
  type SortingState,
  type Updater
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, GripVertical, Loader2 } from "lucide-react";
import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { downloadExcel } from "@/assets/lib/excel";
import { cn, errorMessage } from "@/assets/lib/utils";
import ParquetTableBar, { type ParquetTableBarColumn, type ParquetTableBarFilter } from "@/components/bar/ParquetTableBar";
import { StatusBadge } from "@/components/badge/StatusBadge";
import { AppPagination } from "@/components/pagination/AppPagination";
import { useAnimatedColumnVisibility } from "@/components/table/useAnimatedColumnVisibility";
import type { ParquetColumnConfig, ParquetColumnConfigs, ParquetFilterValue, ParquetNumericColumnStats, ParquetNumericColumnStatsMap, ParquetTableQuery } from "@/types/table";
import { Card, CardContent } from "@/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import "@/components/table/ParquetDataTable.less";

export type ParquetDataRow = Record<string, unknown>;
type DataRow = ParquetDataRow;
type ResolvedColumnConfig = Required<Pick<ParquetColumnConfig, "filter" | "label" | "sortable" | "type">> & ParquetColumnConfig;
type ParquetColumnMeta = { config: ResolvedColumnConfig };

const parquetTableFeatures = tableFeatures({
  cellSpanningFeature,
  columnFilteringFeature,
  columnOrderingFeature,
  columnPinningFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
  columnMeta: {} as ParquetColumnMeta
});
const columnHelper = createColumnHelper<typeof parquetTableFeatures, DataRow>();
const emptyColumnConfigs: ParquetColumnConfigs = {};
const minimumTableHeight = 180;
const dateFilterFn = constructFilterFn({
  autoRemove: (value) => !value,
  filter: (dataValue, filterValue) => formatDate(dataValue, false).includes(filterValue),
  resolveFilterValue: (value) => String(value)
});

export type ParquetDataTableProps = {
  columnConfigs?: ParquetColumnConfigs;
  columns?: readonly string[];
  containerClassName?: string;
  download?: {
    fileName: string;
    loadRows?: () => Promise<ParquetDataRow[]>;
    sheetName?: string;
  };
  formatColumnName?: (column: string) => string;
  loading?: boolean;
  numericStats?: ParquetNumericColumnStatsMap;
  pagination?: {
    onPageChange: (page: number) => void;
    onPageSizeChange: (pageSize: number) => void;
    page: number;
    pageSize: number;
    total: number;
  };
  query?: {
    onChange: (query: ParquetTableQuery) => void;
    value: ParquetTableQuery;
  };
  rows: DataRow[];
  timeColumn?: string;
};

export default function ParquetDataTable({ columnConfigs, columns: suppliedColumns, containerClassName = "max-h-[calc(100vh-12rem)]", download, formatColumnName: suppliedNameFormatter, loading = false, numericStats: suppliedNumericStats, pagination, query, rows, timeColumn = "time" }: ParquetDataTableProps) {
  const columnIds = useMemo(() => suppliedColumns?.length ? [...suppliedColumns] : Object.keys(rows[0] ?? {}), [rows, suppliedColumns]);
  const configs = useMemo(() => resolveColumnConfigs(columnIds, rows, columnConfigs ?? emptyColumnConfigs, suppliedNameFormatter, timeColumn), [columnConfigs, columnIds, rows, suppliedNameFormatter, timeColumn]);
  const numericStats = useMemo(() => suppliedNumericStats ?? calculateNumericColumnStats(columnIds, configs, rows), [columnIds, configs, rows, suppliedNumericStats]);
  const defaults = useMemo(() => createDefaultState(columnIds, configs, numericStats), [columnIds, configs, numericStats]);
  const { animationPhases, renderedVisibility, resetVisibility, setVisibility, targetVisibility } = useAnimatedColumnVisibility(defaults.visibility);
  const stateSignature = columnIds.map((id) => `${id}:${configs[id].pin ?? ""}:${configs[id].defaultVisible ?? ""}:${isAllZero(numericStats[id])}`).join("\u0000");
  const appliedStateSignature = useRef("");
  const tableViewport = useRef<HTMLDivElement>(null);
  const resizeStart = useRef<{ height: number; pointerId: number; y: number } | null>(null);

  const [localSorting, setLocalSorting] = useState<SortingState>([]);
  const [localFilters, setLocalFilters] = useState<ColumnFiltersState>([]);
  const [localPagination, setLocalPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(defaults.order);
  const [columnPinning, setColumnPinning] = useState<ColumnPinningState>(defaults.pinning);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [tableHeight, setTableHeight] = useState<number>();
  const sorting = query?.value.sorting ?? localSorting;
  const columnFilters = query?.value.filters ?? localFilters;
  const paginationState = pagination ? { pageIndex: Math.max(0, pagination.page - 1), pageSize: pagination.pageSize } : localPagination;

  useEffect(() => {
    if (appliedStateSignature.current === stateSignature) return;
    appliedStateSignature.current = stateSignature;
    setColumnOrder(defaults.order);
    setColumnPinning(defaults.pinning);
    resetVisibility(defaults.visibility);
    setLocalPagination((current) => ({ ...current, pageIndex: 0 }));
  }, [defaults, resetVisibility, stateSignature]);

  const resetPage = useCallback(() => {
    if (pagination) pagination.onPageChange(1);
    else setLocalPagination((current) => ({ ...current, pageIndex: 0 }));
  }, [pagination]);

  const updateSorting = useCallback((updater: Updater<SortingState>) => {
    const next = functionalUpdate(updater, sorting);
    if (query) query.onChange({ filters: query.value.filters, sorting: next });
    else setLocalSorting(next);
    resetPage();
  }, [query, resetPage, sorting]);

  const updateFilters = useCallback((updater: Updater<ColumnFiltersState>) => {
    const next = functionalUpdate(updater, columnFilters);
    if (query) query.onChange({ filters: next as ParquetTableQuery["filters"], sorting: query.value.sorting });
    else setLocalFilters(next);
    resetPage();
  }, [columnFilters, query, resetPage]);

  const definitions = useMemo(() => columnHelper.columns(columnIds.map((id) => {
    const config = configs[id];
    return columnHelper.accessor((row) => row[id], {
      id,
      header: config.label,
      cell: (context) => renderCell(context.getValue(), config),
      enableColumnFilter: Boolean(config.filter),
      enableHiding: !config.pin,
      enableSorting: config.sortable,
      filterFn: config.filter === "date" ? dateFilterFn : config.filter === "text" ? filterFn_includesString : filterFn_weakEquals,
      meta: { config },
      size: Math.max(config.size ?? defaultColumnSize(config), minimumHeaderSize(config)),
      spanRows: config.spanRows,
      sortFn: sortFunction(config)
    });
  })), [columnIds, configs]);

  const table = useTable({
    columns: definitions,
    data: rows,
    features: parquetTableFeatures,
    manualFiltering: Boolean(query),
    manualPagination: Boolean(pagination),
    manualSorting: Boolean(query),
    onColumnFiltersChange: updateFilters,
    onColumnOrderChange: setColumnOrder,
    onColumnPinningChange: setColumnPinning,
    onColumnVisibilityChange: setVisibility,
    onPaginationChange: (updater) => {
      const next = functionalUpdate(updater, paginationState);
      if (pagination) {
        if (next.pageSize !== pagination.pageSize) pagination.onPageSizeChange(next.pageSize);
        if (next.pageIndex + 1 !== pagination.page) pagination.onPageChange(next.pageIndex + 1);
      } else setLocalPagination(next);
    },
    onSortingChange: updateSorting,
    rowCount: pagination?.total,
    state: { columnFilters, columnOrder, columnPinning, columnVisibility: renderedVisibility, pagination: paginationState, sorting }
  });

  const setFilter = useCallback((id: string, value: ParquetFilterValue | undefined) => {
    const current = columnFilters.find((filter) => filter.id === id)?.value;
    if (current === value || current === undefined && value === undefined) return;
    updateFilters((filters) => value === undefined ? filters.filter((filter) => filter.id !== id) : [...filters.filter((filter) => filter.id !== id), { id, value }]);
  }, [columnFilters, updateFilters]);

  const barColumns: ParquetTableBarColumn[] = columnIds.map((id) => {
    const column = table.getColumn(id);
    return { canHide: column?.getCanHide() ?? false, group: configs[id].group, id, label: configs[id].label, visible: targetVisibility[id] !== false };
  });
  const barFilters: ParquetTableBarFilter[] = columnIds.flatMap((id) => {
    const config = configs[id];
    if (!config.filter) return [];
    return [{ id, label: config.filterLabel ?? config.label, options: config.enum, order: config.filterOrder ?? defaultFilterOrder(id, config, timeColumn), type: config.filter, value: columnFilters.find((filter) => filter.id === id)?.value as ParquetFilterValue | undefined }];
  }).sort((left, right) => left.order - right.order || columnIds.indexOf(left.id) - columnIds.indexOf(right.id)).map((filter) => ({ id: filter.id, label: filter.label, options: filter.options, type: filter.type, value: filter.value }));
  const total = pagination?.total ?? table.getPrePaginatedRowModel().rows.length;
  const totalPages = Math.max(1, Math.ceil(total / paginationState.pageSize));
  const safePage = Math.min(paginationState.pageIndex + 1, totalPages);
  const targetTableWidth = columnIds.reduce((width, id) => targetVisibility[id] === false ? width : width + (table.getColumn(id)?.getSize() ?? 0), 0);

  function resetTable() {
    if (query) query.onChange({ filters: [], sorting: [] });
    else { setLocalFilters([]); setLocalSorting([]); }
    setColumnOrder(defaults.order);
    setColumnPinning(defaults.pinning);
    setVisibility(defaults.visibility);
    resetPage();
  }

  async function downloadAllRows() {
    if (!download || downloading) return;
    setDownloading(true);
    setDownloadError("");
    try {
      const exportRows = download.loadRows ? await download.loadRows() : rows;
      const dateColumns = Object.fromEntries(columnIds.flatMap((column) => configs[column].type === "date" || configs[column].type === "datetime" ? [[column, configs[column].type]] : [])) as Record<string, "date" | "datetime">;
      await downloadExcel({ columns: columnIds, dateColumns, fileName: download.fileName, rows: exportRows, sheetName: download.sheetName });
    } catch (reason) {
      setDownloadError(errorMessage(reason));
    } finally {
      setDownloading(false);
    }
  }

  function moveColumn(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    const sourcePin = table.getColumn(sourceId)?.getIsPinned() ?? false;
    const targetPin = table.getColumn(targetId)?.getIsPinned() ?? false;
    if (sourcePin !== targetPin) return;
    if (sourcePin === "start" || sourcePin === "end") {
      setColumnPinning((current) => ({ ...current, [sourcePin]: moveItem(current[sourcePin], sourceId, targetId) }));
    } else setColumnOrder((current) => moveItem(current, sourceId, targetId));
  }

  function startHeightResize(event: ReactPointerEvent<HTMLDivElement>) {
    const viewport = tableViewport.current;
    if (!viewport) return;
    resizeStart.current = { height: viewport.getBoundingClientRect().height, pointerId: event.pointerId, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function resizeHeight(event: ReactPointerEvent<HTMLDivElement>) {
    const start = resizeStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    setTableHeight(clampTableHeight(start.height + event.clientY - start.y));
  }

  function finishHeightResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (resizeStart.current?.pointerId !== event.pointerId) return;
    resizeStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function resizeHeightWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const currentHeight = tableViewport.current?.getBoundingClientRect().height ?? minimumTableHeight;
    setTableHeight(clampTableHeight(currentHeight + (event.key === "ArrowDown" ? 40 : -40)));
    event.preventDefault();
  }

  return <Card className="relative overflow-hidden py-0"><CardContent className="p-0">
    {loading ? <div className="absolute inset-0 z-50 grid place-items-center bg-card/50 backdrop-blur-[1px]"><Loader2 aria-label="正在更新表格" className="animate-spin text-primary" /></div> : null}
    <ParquetTableBar columns={barColumns} download={download ? { disabled: loading || downloading || !columnIds.length, loading: downloading, onClick: downloadAllRows } : undefined} filters={barFilters} onFilter={setFilter} onReset={resetTable} onToggleColumn={(id, visible) => setVisibility((current) => ({ ...current, [id]: visible }))} onToggleGroup={(group, visible) => setVisibility((current) => ({ ...current, ...Object.fromEntries(barColumns.filter((column) => column.group === group && column.canHide).map((column) => [column.id, visible])) }))} />
    {downloadError ? <div className="border-b border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">Excel 导出失败：{downloadError}</div> : null}
    <Table className="parquet-data-table table-fixed" containerClassName={`${containerClassName} overflow-auto`} containerRef={tableViewport} containerStyle={tableHeight === undefined ? undefined : { height: tableHeight, maxHeight: "none" }} style={{ width: targetTableWidth }}>
      <TableHeader className="sticky top-0 z-30 bg-card shadow-sm">
        {table.getHeaderGroups().map((headerGroup) => <TableRow key={headerGroup.id}>{headerGroup.headers.map((header) => {
          const config = header.column.columnDef.meta?.config;
          const sorted = header.column.getIsSorted();
          const pinned = header.column.getIsPinned();
          return <TableHead className={cn("parquet-column-cell group/header px-2", pinned && "bg-card", pinned === "start" && header.column.getIsLastColumn("start") && "shadow-[4px_0_6px_-5px_rgb(0_0_0/0.35)]", pinned === "end" && header.column.getIsFirstColumn("end") && "shadow-[-4px_0_6px_-5px_rgb(0_0_0/0.35)]")} data-column-animation={animationPhases[header.column.id]} data-column-id={header.column.id} key={header.id} style={pinnedColumnStyle(header.column)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); moveColumn(event.dataTransfer.getData("text/plain"), header.column.id); }}>
            <div className={cn("flex items-center gap-1", isNumeric(config) && "justify-end")}>
              <span className="cursor-grab text-muted-foreground/55 opacity-0 transition-opacity group-hover/header:opacity-100" draggable title={pinned ? "拖动调整固定列顺序" : "拖动调整列顺序"} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", header.column.id); }}><GripVertical className="size-3.5" /></span>
              {header.isPlaceholder
? null
: header.column.getCanSort()
                ? <button className="flex min-w-0 items-center gap-1 rounded px-1 py-1 hover:bg-muted" title={`按${config?.label ?? header.column.id}排序`} onClick={header.column.getToggleSortingHandler()}><span className="truncate">{config?.label ?? header.column.id}</span>{sorted === "asc" ? <ArrowUp className="size-3.5" /> : sorted === "desc" ? <ArrowDown className="size-3.5" /> : <ArrowUpDown className="size-3.5 text-muted-foreground" />}</button>
                : <span className="min-w-0 truncate px-1" title={config?.label ?? header.column.id}>{config?.label ?? header.column.id}</span>}
            </div>
          </TableHead>;
        })}</TableRow>)}
      </TableHeader>
      <TableBody>{table.getRowModel().rows.length
? table.getRowModel().rows.map((row) => <TableRow className="group/row" key={row.id}>{row.getVisibleCells().map((cell) => {
        if (cell.getIsCovered()) return null;
        const config = cell.column.columnDef.meta?.config;
        const pinned = cell.column.getIsPinned();
        const title = formatCellText(cell.getValue(), config);
        return <TableCell className={cn("parquet-column-cell max-w-80 truncate px-3 font-mono text-xs tabular-nums", isNumeric(config) && "text-right", pinned && "bg-card group-hover/row:bg-muted", pinned === "start" && cell.column.getIsLastColumn("start") && "shadow-[4px_0_6px_-5px_rgb(0_0_0/0.35)]", pinned === "end" && cell.column.getIsFirstColumn("end") && "shadow-[-4px_0_6px_-5px_rgb(0_0_0/0.35)]")} colSpan={cell.getColSpan()} data-column-animation={animationPhases[cell.column.id]} data-column-id={cell.column.id} key={cell.id} rowSpan={cell.getRowSpan()} style={{ ...pinnedColumnStyle(cell.column), ...numericHeatmapStyle(cell.getValue(), numericStats[cell.column.id]) }} title={title}><table.FlexRender cell={cell} /></TableCell>;
      })}</TableRow>)
: <TableRow><TableCell className="h-28 text-center text-sm text-muted-foreground" colSpan={Math.max(1, table.getVisibleLeafColumns().length)}>没有符合当前筛选条件的数据</TableCell></TableRow>}</TableBody>
    </Table>
    <div aria-label="调整表格高度" aria-orientation="horizontal" aria-valuemin={minimumTableHeight} aria-valuemax={maximumTableHeight()} aria-valuenow={tableHeight} className="group flex h-2 touch-none cursor-row-resize items-center justify-center bg-muted/15 outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40" role="separator" tabIndex={0} title="拖动调整表格高度，双击恢复自动高度" onDoubleClick={() => setTableHeight(undefined)} onKeyDown={resizeHeightWithKeyboard} onPointerCancel={finishHeightResize} onPointerDown={startHeightResize} onPointerMove={resizeHeight} onPointerUp={finishHeightResize}>
      <span className="h-0.5 w-10 rounded-full bg-muted-foreground/20 transition-colors group-hover:bg-muted-foreground/40 group-focus-visible:bg-muted-foreground/40" />
    </div>
    <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><span className="text-xs text-muted-foreground">共 {total.toLocaleString("zh-CN")} 条</span><AppPagination page={safePage} pageSize={paginationState.pageSize} totalPages={totalPages} onPageChange={(page) => pagination ? pagination.onPageChange(page) : setLocalPagination((current) => ({ ...current, pageIndex: page - 1 }))} onPageSizeChange={(pageSize) => pagination ? pagination.onPageSizeChange(pageSize) : setLocalPagination({ pageIndex: 0, pageSize })} /></div>
  </CardContent></Card>;
}

function formatColumnName(column: string) {
  const commonNames: Record<string, string> = { code: "证券代码", date: "日期", symbol: "证券代码", time: "时间" };
  return commonNames[column.toLowerCase()] ?? column;
}

function resolveColumnConfigs(columnIds: string[], rows: DataRow[], supplied: ParquetColumnConfigs, nameFormatter: ((column: string) => string) | undefined, timeColumn: string) {
  return Object.fromEntries(columnIds.map((id) => {
    const inferred = inferColumnConfig(id, rows, timeColumn);
    const configured = supplied[id] ?? {};
    const merged = { ...inferred, ...configured };
    return [id, { ...merged, filter: merged.filter ?? false, label: configured.label ?? nameFormatter?.(id) ?? inferred.label, sortable: merged.sortable ?? false, type: merged.type ?? "auto" } satisfies ResolvedColumnConfig];
  })) as Record<string, ResolvedColumnConfig>;
}

function inferColumnConfig(id: string, rows: DataRow[], timeColumn: string): ResolvedColumnConfig {
  const lower = id.toLowerCase();
  const sample = rows.map((row) => row[id]).find((value) => value !== null && value !== undefined);
  const namedConfig = inferNamedColumnConfig(id, lower, timeColumn);
  if (namedConfig) return namedConfig;
  const valueConfig = inferValueColumnConfig(id, sample);
  if (valueConfig) return valueConfig;
  const enumConfig = inferEnumColumnConfig(id, lower, rows);
  if (enumConfig) return enumConfig;
  return { filter: false, label: formatColumnName(id), sortable: false, type: "string" };
}

function inferNamedColumnConfig(id: string, lower: string, timeColumn: string): ResolvedColumnConfig | null {
  const isTime = lower === timeColumn.toLowerCase() || lower === "date" || lower.endsWith("date");
  if (isTime) {
    const type = lower.includes("time") && lower !== "time" ? "datetime" : "date";
    return { filter: "date", filterLabel: "日期", filterOrder: 0, label: formatColumnName(id), pin: "start", sortable: true, spanRows: true, type, size: type === "datetime" ? 112 : 132 };
  }
  const isCode = lower === "code" || lower === "symbol" || lower.endsWith("_code") || lower.endsWith("code");
  return isCode ? { filter: "text", label: formatColumnName(id), pin: "start", sortable: false, type: "string", size: 140 } : null;
}

function inferValueColumnConfig(id: string, sample: unknown): ResolvedColumnConfig | null {
  if (typeof sample === "boolean") return { enum: { true: { label: "是", tone: "green" }, false: { label: "否", tone: "neutral" } }, filter: "enum", label: formatColumnName(id), sortable: false, type: "boolean" };
  if (typeof sample === "number") return { filter: false, label: formatColumnName(id), sortable: true, type: Number.isInteger(sample) ? "integer" : "number" };
  if (typeof sample === "bigint") return { filter: false, label: formatColumnName(id), sortable: true, type: "integer" };
  if (sample instanceof Date) return { filter: false, label: formatColumnName(id), sortable: true, type: "datetime", size: 112 };
  return null;
}

function inferEnumColumnConfig(id: string, lower: string, rows: DataRow[]): ResolvedColumnConfig | null {
  if (!looksLikeEnum(lower)) return null;
  const values = [...new Set(rows.map((row) => row[id]).filter((value) => value !== null && value !== undefined).map(String))].slice(0, 21);
  return values.length <= 20 ? { enum: Object.fromEntries(values.map((value) => [value, { label: value, tone: "neutral" }])), filter: "enum", label: formatColumnName(id), sortable: false, type: "enum" } : null;
}

function createDefaultState(columnIds: string[], configs: Record<string, ResolvedColumnConfig>, numericStats: ParquetNumericColumnStatsMap) {
  return {
    order: [...columnIds],
    pinning: { start: columnIds.filter((id) => configs[id].pin === "start"), end: columnIds.filter((id) => configs[id].pin === "end") },
    visibility: Object.fromEntries(columnIds.filter((id) => configs[id].defaultVisible === false || !configs[id].pin && isAllZero(numericStats[id])).map((id) => [id, false]))
  };
}

function defaultFilterOrder(id: string, config: ResolvedColumnConfig, timeColumn: string) {
  if (config.filter === "date" || id.toLowerCase() === timeColumn.toLowerCase()) return 0;
  const lower = id.toLowerCase();
  if (lower === "code" || lower === "symbol" || lower.endsWith("_code") || lower.endsWith("code")) return 10;
  return 100;
}

function isAllZero(stats: ParquetNumericColumnStats | undefined) {
  return stats !== undefined && stats.min === 0 && stats.max === 0;
}

function renderCell(value: unknown, config: ResolvedColumnConfig): ReactNode {
  if (value === null || value === undefined) return <span className="text-muted-foreground">NULL</span>;
  const option = config.enum?.[String(value)];
  if (option) return <StatusBadge className="font-sans font-normal" tone={option.tone ?? "neutral"}>{option.label}</StatusBadge>;
  if (config.type === "datetime") {
    const [date, time] = formatDate(value, true).split(" ");
    return <span className="inline-flex flex-col leading-tight"><span>{date}</span>{time ? <span className="text-muted-foreground">{time}</span> : null}</span>;
  }
  return formatCellText(value, config);
}

function formatCellText(value: unknown, config: ResolvedColumnConfig | undefined): string {
  if (value === null || value === undefined) return "NULL";
  const option = config?.enum?.[String(value)];
  if (option) return option.label;
  if (config?.type === "date") return formatDate(value, false);
  if (config?.type === "datetime") return formatDate(value, true);
  if (typeof value === "number") return config?.format === "percent" ? `${formatNumber(value * 100)}%` : formatNumber(value, config?.type === "integer");
  if (typeof value === "bigint") return value.toLocaleString("zh-CN");
  if (value instanceof Date) return formatDate(value, true);
  if (typeof value === "object") return JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item);
  return String(value);
}

function formatNumber(value: number, integer = false) {
  if (!Number.isFinite(value)) return String(value);
  if (integer) return Math.trunc(value).toLocaleString("zh-CN");
  if (value === 0) return "0";
  return Math.abs(value) < 1 ? value.toPrecision(3) : value.toFixed(3);
}

function formatDate(value: unknown, includeTime: boolean) {
  let date: Date | null = value instanceof Date ? value : null;
  if (!date && (typeof value === "number" || typeof value === "bigint" || typeof value === "string" && /^\d+$/.test(value))) {
    const timestamp = Number(value);
    date = new Date(timestamp > 10_000_000_000_000 ? timestamp / 1000 : timestamp);
  }
  if (date && !Number.isNaN(date.getTime())) return includeTime ? date.toISOString().replace("T", " ").slice(0, 19) : date.toISOString().slice(0, 10);
  return String(value).replace("T", " ").slice(0, includeTime ? 19 : 10);
}

function defaultColumnSize(config: ResolvedColumnConfig) {
  if (config.type === "datetime") return 112;
  if (config.type === "date") return 132;
  if (config.type === "integer" || config.type === "number") return 136;
  return 152;
}

function minimumHeaderSize(config: ResolvedColumnConfig) {
  const labelWidth = Array.from(config.label).reduce((width, character) => width + ((character.codePointAt(0) ?? 0) > 0xff ? 14 : 8), 0);
  return Math.min(280, Math.ceil(labelWidth + (config.sortable ? 64 : 44)));
}

function sortFunction(config: ResolvedColumnConfig) {
  if (config.type === "date" || config.type === "datetime") return sortFn_datetime;
  if (config.type === "integer" || config.type === "number" || config.type === "boolean" || config.type === "enum") return sortFn_basic;
  return sortFn_alphanumeric;
}

function isNumeric(config: ResolvedColumnConfig | undefined) { return config?.type === "integer" || config?.type === "number"; }
function calculateNumericColumnStats(columnIds: string[], configs: Record<string, ResolvedColumnConfig>, rows: DataRow[]) {
  const stats: ParquetNumericColumnStatsMap = {};
  for (const id of columnIds) {
    if (!isNumeric(configs[id])) continue;
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let count = 0;
    for (const row of rows) {
      const value = numericValue(row[id]);
      if (value === null) continue;
      min = Math.min(min, value);
      max = Math.max(max, value);
      sum += value;
      count += 1;
    }
    if (count && Number.isFinite(min) && Number.isFinite(max) && Number.isFinite(sum)) stats[id] = { min, mean: sum / count, max };
  }
  return stats;
}

function numericHeatmapStyle(value: unknown, stats: ParquetNumericColumnStats | undefined): CSSProperties {
  const number = numericValue(value);
  if (number === null || !stats || stats.min === stats.max || number === stats.mean) return {};

  const aboveMean = number > stats.mean;
  const distanceToEdge = aboveMean ? stats.max - stats.mean : stats.mean - stats.min;
  if (distanceToEdge <= 0) return {};

  const distanceToMean = Math.abs(number - stats.mean);
  const intensity = Math.min(1, distanceToMean / distanceToEdge);
  const color = aboveMean ? "239, 68, 68" : "59, 130, 246";
  const overlay = `rgba(${color}, ${intensity * 0.2})`;
  return { backgroundColor: "var(--panel)", backgroundImage: `linear-gradient(${overlay}, ${overlay})` };
}

function numericValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function looksLikeEnum(column: string) { return /(^|_)(direction|side|state|status|type)$/.test(column) || column.endsWith("status") || column.endsWith("state"); }
function maximumTableHeight() { return Math.max(minimumTableHeight, window.innerHeight - 96); }
function clampTableHeight(height: number) { return Math.round(Math.min(maximumTableHeight(), Math.max(minimumTableHeight, height))); }

function pinnedColumnStyle(column: { getAfter: (position?: "center" | "end" | "start" | false) => number; getIsPinned: () => "end" | "start" | false; getSize: () => number; getStart: (position?: "center" | "end" | "start" | false) => number }): CSSProperties {
  const pinned = column.getIsPinned();
  const size = column.getSize();
  return {
    insetInlineEnd: pinned === "end" ? column.getAfter("end") : undefined,
    insetInlineStart: pinned === "start" ? column.getStart("start") : undefined,
    maxWidth: size,
    minWidth: size,
    position: pinned ? "sticky" : "relative",
    width: size,
    zIndex: pinned ? 20 : undefined
  };
}

function moveItem(items: string[], source: string, target: string) {
  const next = items.filter((item) => item !== source);
  const targetIndex = next.indexOf(target);
  next.splice(targetIndex < 0 ? next.length : targetIndex, 0, source);
  return next;
}
