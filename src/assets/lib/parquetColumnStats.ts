import type { BrowserDuckDb } from "@/assets/lib/duckdb";
import type { ParquetNumericColumnStatsMap } from "@/types/table";

export async function readParquetNumericColumnStats(database: BrowserDuckDb, file: string, columns: readonly string[], where = ""): Promise<ParquetNumericColumnStatsMap> {
  const numericColumns = [...new Set(columns)];
  if (!numericColumns.length) return {};

  const projections = numericColumns.flatMap((column, index) => {
    const source = identifier(column);
    return [
      `min(${source}) AS ${identifier(`min_${index}`)}`,
      `avg(${source}) AS ${identifier(`mean_${index}`)}`,
      `max(${source}) AS ${identifier(`max_${index}`)}`
    ];
  });
  const row = (await database.rows(`SELECT ${projections.join(", ")} FROM read_parquet(${literal(file)}) ${where}`))[0] ?? {};

  return Object.fromEntries(numericColumns.flatMap((column, index) => {
    const min = toFiniteNumber(row[`min_${index}`]);
    const mean = toFiniteNumber(row[`mean_${index}`]);
    const max = toFiniteNumber(row[`max_${index}`]);
    return min === null || mean === null || max === null ? [] : [[column, { min, mean, max }]];
  }));
}

export function isDuckDbNumericType(value: unknown) {
  return /^(?:U?(?:TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|INT(?:8|16|32|64|128)?)|FLOAT|DOUBLE|REAL|DECIMAL|NUMERIC)/i.test(String(value ?? ""));
}

function identifier(value: string) { return `"${value.replace(/"/g, "\"\"")}"`; }
function literal(value: string) { return `'${value.replace(/'/g, "''")}'`; }
function toFiniteNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
