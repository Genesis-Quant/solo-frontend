import { ChevronDown, ChevronRight, Columns3, Download, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import type { ParquetEnumOption, ParquetFilterValue } from "@/types/table";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from "@/ui/dropdown-menu";
import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";

export type ParquetTableBarColumn = {
  canHide: boolean;
  group?: string;
  id: string;
  label: string;
  visible: boolean;
};

export type ParquetTableBarFilter = {
  id: string;
  label: string;
  options?: Record<string, ParquetEnumOption>;
  type: "date" | "enum" | "text";
  value: ParquetFilterValue | undefined;
};

type ParquetTableBarProps = {
  columns: ParquetTableBarColumn[];
  download?: {
    disabled: boolean;
    loading: boolean;
    onClick: () => void;
  };
  filters: ParquetTableBarFilter[];
  onFilter: (id: string, value: ParquetFilterValue | undefined) => void;
  onReset: () => void;
  onToggleColumn: (id: string, visible: boolean) => void;
  onToggleGroup: (group: string, visible: boolean) => void;
};

export default function ParquetTableBar({ columns, download, filters, onFilter, onReset, onToggleColumn, onToggleGroup }: ParquetTableBarProps) {
  const groupedColumns = groupColumns(columns);
  const namedGroups = [...groupedColumns.keys()].filter((group) => group !== "");

  return <div className="flex flex-wrap items-center gap-1 border-b bg-muted/20 px-2 py-1.5 text-xs">
    {filters.map((filter) => filter.type === "enum"
      ? <EnumFilter filter={filter} key={filter.id} onFilter={onFilter} />
      : <TextFilter filter={filter} key={filter.id} onFilter={onFilter} />)}
    {namedGroups.length
? <div className="flex flex-wrap items-center gap-1 border-l pl-1.5">
      {namedGroups.map((group) => {
        const groupItems = groupedColumns.get(group) ?? [];
        const expanded = groupItems.some((column) => column.visible);
        return <Button aria-expanded={expanded} className="rounded-sm bg-transparent shadow-none" key={group} size="xs" variant="ghost" onClick={() => onToggleGroup(group, !expanded)}>{expanded ? <ChevronDown /> : <ChevronRight />}{group}</Button>;
      })}
    </div>
: null}
    <div className="ml-auto flex items-center gap-0.5">
      <ColumnMenu columns={columns} groupedColumns={groupedColumns} onToggleColumn={onToggleColumn} onToggleGroup={onToggleGroup} />
      <Button aria-label="恢复表格默认设置" className="rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" size="icon-xs" title="恢复默认" variant="ghost" onClick={onReset}><RotateCcw /></Button>
      {download ? <Button aria-label="下载全部原始数据为 Excel" className="rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" disabled={download.disabled} size="icon-xs" title="下载全部原始数据为 Excel" variant="ghost" onClick={download.onClick}>{download.loading ? <Loader2 className="animate-spin" /> : <Download />}</Button> : null}
    </div>
  </div>;
}

function TextFilter({ filter, onFilter }: { filter: ParquetTableBarFilter; onFilter: ParquetTableBarProps["onFilter"] }) {
  const [value, setValue] = useState(String(filter.value ?? ""));
  useEffect(() => { setValue(String(filter.value ?? "")); }, [filter.value]);
  useEffect(() => {
    const timeout = window.setTimeout(() => onFilter(filter.id, value.trim() || undefined), 300);
    return () => window.clearTimeout(timeout);
  }, [filter.id, onFilter, value]);
  return <Input aria-label={`筛选${filter.label}`} className={filter.type === "date" ? "h-6 w-24 rounded-sm px-2 py-0 text-xs" : "h-6 w-28 rounded-sm px-2 py-0 text-xs"} placeholder={`筛选${filter.label}`} value={value} onChange={(event) => setValue(event.target.value)} />;
}

function EnumFilter({ filter, onFilter }: { filter: ParquetTableBarFilter; onFilter: ParquetTableBarProps["onFilter"] }) {
  return <Select value={filter.value === undefined ? "__all__" : String(filter.value)} onValueChange={(value) => onFilter(filter.id, value === "__all__" ? undefined : value)}>
    <SelectTrigger aria-label={`筛选${filter.label}`} className="min-w-24 gap-1 rounded-sm px-2 py-0 text-xs data-[size=sm]:h-6 [&_svg:not([class*='size-'])]:size-3" size="sm"><SelectValue /></SelectTrigger>
    <SelectContent><SelectItem value="__all__">全部{filter.label}</SelectItem>{Object.entries(filter.options ?? {}).map(([value, option]) => <SelectItem key={value} value={value}>{option.label}</SelectItem>)}</SelectContent>
  </Select>;
}

function ColumnMenu({ columns, groupedColumns, onToggleColumn, onToggleGroup }: { columns: ParquetTableBarColumn[]; groupedColumns: Map<string, ParquetTableBarColumn[]>; onToggleColumn: ParquetTableBarProps["onToggleColumn"]; onToggleGroup: ParquetTableBarProps["onToggleGroup"] }) {
  const standalone = groupedColumns.get("") ?? [];
  return <DropdownMenu><DropdownMenuTrigger asChild><Button aria-label="选择显示列" className="rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" size="icon-xs" title="选择显示列" variant="ghost"><Columns3 /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-52">
    <DropdownMenuLabel>显示列</DropdownMenuLabel><DropdownMenuSeparator />
    {standalone.map((column) => <ColumnItem column={column} key={column.id} onToggleColumn={onToggleColumn} />)}
    {[...groupedColumns.entries()].filter(([group]) => group).map(([group, groupItems]) => <DropdownMenuSub key={group}>
      <DropdownMenuSubTrigger>{group}<span className="ml-auto text-xs text-muted-foreground">{groupItems.filter((column) => column.visible).length}/{groupItems.length}</span></DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-52"><DropdownMenuCheckboxItem checked={groupItems.every((column) => column.visible)} onCheckedChange={(checked) => onToggleGroup(group, Boolean(checked))}>显示整组</DropdownMenuCheckboxItem><DropdownMenuSeparator />{groupItems.map((column) => <ColumnItem column={column} key={column.id} onToggleColumn={onToggleColumn} />)}</DropdownMenuSubContent>
    </DropdownMenuSub>)}
    {!columns.some((column) => column.canHide) ? <div className="px-2 py-1.5 text-xs text-muted-foreground">固定列不可隐藏</div> : null}
  </DropdownMenuContent></DropdownMenu>;
}

function ColumnItem({ column, onToggleColumn }: { column: ParquetTableBarColumn; onToggleColumn: ParquetTableBarProps["onToggleColumn"] }) {
  return <DropdownMenuCheckboxItem checked={column.visible} disabled={!column.canHide} onCheckedChange={(checked) => onToggleColumn(column.id, Boolean(checked))}>{column.label}</DropdownMenuCheckboxItem>;
}

function groupColumns(columns: ParquetTableBarColumn[]) {
  const groups = new Map<string, ParquetTableBarColumn[]>();
  columns.forEach((column) => {
    const group = column.group ?? "";
    groups.set(group, [...groups.get(group) ?? [], column]);
  });
  return groups;
}
