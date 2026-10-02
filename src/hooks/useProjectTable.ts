import { useCallback } from "react";

import type { ProjectTableColumn } from "@/components/table/ProjectDataTable";
import { usePageState } from "@/store/pageMemory";
import type { ProjectSortOrder } from "@/types/table";

/** Solo 列表接口返回全量记录；为 Arena 表格提供排序和分页后的数据，状态按 scope 记忆。 */
export function useProjectTable<T, S extends string>(scope: string, data: T[], columns: ProjectTableColumn<T, S>[], initialSort: S) {
  const [page, setPage] = usePageState(scope, "page", 1);
  const [pageSize, setPageSize] = usePageState(scope, "pageSize", 20);
  const [field, setField] = usePageState(scope, "sortField", initialSort);
  const [order, setOrder] = usePageState<ProjectSortOrder>(scope, "sortOrder", "desc");
  const sortColumn = columns.find((column) => column.sortKey === field);
  const sorted = [...data].sort((a, b) => {
    const left = sortColumn?.value(a);
    const right = sortColumn?.value(b);
    const comparison = typeof left === "number" && typeof right === "number"
      ? left - right
      : String(left ?? "").localeCompare(String(right ?? ""), "zh-CN", { numeric: true });
    return order === "asc" ? comparison : -comparison;
  });
  const currentPage = Math.min(page, Math.max(1, Math.ceil(data.length / pageSize)));
  const resetPage = useCallback(() => setPage(1), [setPage]);
  return {
    resetPage,
    rows: sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    pagination: { page: currentPage, pageSize, total: data.length, onPageChange: setPage,
      onPageSizeChange: (value: number) => { setPageSize(value); setPage(1); } },
    sorting: { field, order, onChange: (nextField: S, nextOrder: ProjectSortOrder) => {
      setField(nextField); setOrder(nextOrder); setPage(1);
    } }
  };
}
