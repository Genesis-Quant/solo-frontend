export type TableStatusTone = "blue" | "green" | "amber" | "red" | "neutral";

export type ParquetColumnType = "auto" | "boolean" | "date" | "datetime" | "enum" | "integer" | "number" | "string";
export type ParquetColumnFilter = "date" | "enum" | "text" | false;
export type ParquetFilterValue = boolean | number | string;

export type ParquetEnumOption = {
  label: string;
  tone?: TableStatusTone;
};

export type ParquetColumnConfig = {
  defaultVisible?: boolean;
  enum?: Record<string, ParquetEnumOption>;
  filter?: ParquetColumnFilter;
  filterLabel?: string;
  filterOrder?: number;
  format?: "percent";
  group?: string;
  label?: string;
  pin?: "end" | "start";
  size?: number;
  sortable?: boolean;
  spanRows?: boolean;
  type?: ParquetColumnType;
};

export type ParquetColumnConfigs = Record<string, ParquetColumnConfig>;
export type ParquetNumericColumnStats = { max: number; mean: number; min: number };
export type ParquetNumericColumnStatsMap = Record<string, ParquetNumericColumnStats>;

export type ParquetColumnFilterState = {
  id: string;
  value: ParquetFilterValue;
};

export type ParquetColumnSortState = {
  desc: boolean;
  id: string;
};

export type ParquetTableQuery = {
  filters: ParquetColumnFilterState[];
  sorting: ParquetColumnSortState[];
};

export const emptyParquetTableQuery = (): ParquetTableQuery => ({ filters: [], sorting: [] });
