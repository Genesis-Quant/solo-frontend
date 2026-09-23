import type { Cell, Sheet } from "write-excel-file/browser";

const maximumExcelColumns = 16_384;
const maximumExcelRows = 1_048_576;
const maximumExcelCellLength = 32_767;

type ExcelRow = Record<string, unknown>;

type DownloadExcelOptions = {
  columns: readonly string[];
  dateColumns?: Readonly<Record<string, "date" | "datetime">>;
  fileName: string;
  rows: ExcelRow[];
  sheetName?: string;
};

export async function downloadExcel({ columns, dateColumns, fileName, rows, sheetName = "Data" }: DownloadExcelOptions) {
  if (!columns.length) throw new Error("没有可导出的列");
  if (columns.length > maximumExcelColumns) throw new Error(`列数超过 Excel 上限（${maximumExcelColumns.toLocaleString("zh-CN")} 列）`);

  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const dataRowsPerSheet = maximumExcelRows - 1;
  const sheetCount = Math.max(1, Math.ceil(rows.length / dataRowsPerSheet));
  const sheets: Sheet<Blob>[] = Array.from({ length: sheetCount }, (_, sheetIndex) => {
    const start = sheetIndex * dataRowsPerSheet;
    const data = rows.slice(start, start + dataRowsPerSheet).map((row, rowIndex) => columns.map((column) => excelCell(row[column], start + rowIndex + 2, column, dateColumns?.[column])));
    return {
      columns: columns.map((column) => ({ width: Math.min(30, Math.max(12, Array.from(column).length + 2)) })),
      data: [columns.map(headerCell), ...data],
      dateFormat: "yyyy-mm-dd hh:mm:ss",
      sheet: excelSheetName(sheetName, sheetIndex, sheetCount),
      stickyRowsCount: 1
    };
  });

  await writeXlsxFile(sheets).toFile(fileName.toLowerCase().endsWith(".xlsx") ? fileName : `${fileName}.xlsx`);
}

function headerCell(value: string): Cell {
  return { backgroundColor: "#E8ECEA", fontWeight: "bold", format: "@", type: String, value: checkedText(value, 1, value) };
}

function excelCell(value: unknown, row: number, column: string, dateType?: "date" | "datetime"): Cell {
  if (value === null || value === undefined) return null;
  if (dateType) {
    const date = excelDate(value);
    if (date) return { format: dateType === "date" ? "yyyy-mm-dd" : "yyyy-mm-dd hh:mm:ss", type: Date, value: date };
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? textCell(String(value), row, column) : value;
  if (typeof value === "number") return Number.isFinite(value) ? value : textCell(String(value), row, column);
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return textCell(value.toString(), row, column);
  if (typeof value === "string") return textCell(value, row, column);
  return textCell(serialiseValue(value), row, column);
}

function excelDate(value: unknown) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "string" && /^\d+$/.test(value)) {
    const timestamp = Number(value);
    const date = new Date(timestamp > 10_000_000_000_000 ? timestamp / 1000 : timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function textCell(value: string, row: number, column: string): Cell {
  return { format: "@", type: String, value: checkedText(value, row, column) };
}

function checkedText(value: string, row: number, column: string) {
  if (value.length > maximumExcelCellLength) throw new Error(`第 ${row.toLocaleString("zh-CN")} 行“${column}”超过 Excel 单元格长度上限`);
  return value;
}

function serialiseValue(value: unknown) {
  try {
    const result = JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item);
    return result === undefined ? String(value) : result;
  } catch {
    return String(value);
  }
}

function excelSheetName(value: string, index: number, count: number) {
  const suffix = count > 1 ? ` ${index + 1}` : "";
  const maximumBaseLength = 31 - suffix.length;
  const base = value.replace(/[\\/*?:[\]]/g, "_").trim().slice(0, maximumBaseLength) || "Data";
  return `${base}${suffix}`;
}
