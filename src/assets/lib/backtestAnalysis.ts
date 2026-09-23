import { BrowserDuckDb, duckDbDateValue } from "@/assets/lib/duckdb";
import { readParquetNumericColumnStats } from "@/assets/lib/parquetColumnStats";
import { backtestTableConfigs } from "@/assets/lib/backtestTable";
import type { ParquetColumnFilterState, ParquetNumericColumnStatsMap, ParquetTableQuery } from "@/types/table";

export type PortfolioPoint = { time: string; netValue: number | null; benchmarkNetValue: number | null; totalEquity: number | null; dailyReturn: number | null; dailyFee: number | null };
export type BacktestTableName = "trade_details" | "daily_positions" | "daily_portfolios" | "daily_trading_statistics";
export type BacktestTablePage = { columns: string[]; numericStats: ParquetNumericColumnStatsMap; rows: Record<string, unknown>[]; total: number };
export type BacktestDateRange = { start: string; end: string };
type BacktestTableSummary = { numericStats: ParquetNumericColumnStatsMap; total: number };
type BacktestTableSchema = { columns: string[]; columnSet: ReadonlySet<string> };
const maximumSummaryCacheEntries = 24;
const tableSelects: Record<BacktestTableName, string> = {
  trade_details: "* REPLACE (strftime(sendTime, '%Y-%m-%d %H:%M:%S') AS sendTime, strftime(tradeTime, '%Y-%m-%d %H:%M:%S') AS tradeTime)",
  daily_positions: "* REPLACE (strftime(tradeDate, '%Y-%m-%d') AS tradeDate)",
  daily_portfolios: "* REPLACE (strftime(tradeDate, '%Y-%m-%d') AS tradeDate)",
  daily_trading_statistics: "* REPLACE (strftime(tradeDate, '%Y-%m-%d') AS tradeDate)"
};
export const backtestTableTimeColumns: Record<BacktestTableName, string> = { trade_details: "sendTime", daily_positions: "tradeDate", daily_portfolios: "tradeDate", daily_trading_statistics: "tradeDate" };

export class BacktestAnalytics {
  private readonly summaryCache = new Map<string, Promise<BacktestTableSummary>>();
  private readonly schemas = new Map<BacktestTableName, BacktestTableSchema>();

  private constructor(private readonly database: BrowserDuckDb, private readonly files: Record<BacktestTableName, string>, private readonly registered: Set<BacktestTableName>) {}

  static async create(workflowInstanceId: number, dailyPortfolios: ArrayBuffer) {
    const names: BacktestTableName[] = ["trade_details", "daily_positions", "daily_portfolios", "daily_trading_statistics"];
    const files = Object.fromEntries(names.map((name) => [name, `backtest-${workflowInstanceId}-${name}.parquet`])) as Record<BacktestTableName, string>;
    const analytics = new BacktestAnalytics(await BrowserDuckDb.create({ [files.daily_portfolios]: dailyPortfolios }), files, new Set<BacktestTableName>(["daily_portfolios"]));
    await analytics.readSchema("daily_portfolios");
    return analytics;
  }

  isRegistered(name: BacktestTableName) {
    return this.registered.has(name);
  }

  async register(name: BacktestTableName, buffer: ArrayBuffer) {
    if (this.registered.has(name)) return;
    await this.database.register(this.files[name], buffer);
    await this.readSchema(name);
    this.registered.add(name);
  }

  async portfolios(): Promise<PortfolioPoint[]> {
    const benchmarkColumn = this.schema("daily_portfolios").columnSet.has("benchmarkNetValue")
      ? "benchmarkNetValue"
      : "CAST(NULL AS DOUBLE) AS benchmarkNetValue";
    const rows = await this.database.rows(`
      SELECT tradeDate, netValue, ${benchmarkColumn}, totalEquity, ratio,
        totalFee - coalesce(lag(totalFee) OVER (ORDER BY tradeDate), 0) AS dailyFee
      FROM read_parquet(${literal(this.files.daily_portfolios)}) ORDER BY tradeDate
    `);
    return rows.map((row) => ({ time: duckDbDateValue(row.tradeDate), netValue: numberValue(row.netValue), benchmarkNetValue: numberValue(row.benchmarkNetValue), totalEquity: numberValue(row.totalEquity), dailyReturn: numberValue(row.ratio), dailyFee: numberValue(row.dailyFee) }));
  }

  async tablePage(name: BacktestTableName, page: number, pageSize: number, range: BacktestDateRange, query: ParquetTableQuery = { filters: [], sorting: [] }): Promise<BacktestTablePage> {
    if (!this.registered.has(name)) throw new Error(`回测结果尚未加载: ${name}`);
    const file = this.files[name];
    const safePage = Math.max(1, Math.trunc(page));
    const safePageSize = Math.min(500, Math.max(1, Math.trunc(pageSize)));
    const schema = this.schema(name);
    const where = tableWhere(name, range, query.filters, schema.columnSet);
    const orderBy = tableOrderBy(name, query, schema.columnSet);
    const [summary, rows] = await Promise.all([
      this.tableSummary(name, file, where, schema),
      this.database.rows(`SELECT ${tableSelects[name]} FROM read_parquet(${literal(file)}) ${where} ${orderBy} LIMIT ${safePageSize} OFFSET ${(safePage - 1) * safePageSize}`)
    ]);
    return { columns: schema.columns, numericStats: summary.numericStats, rows, total: summary.total };
  }

  async rawTable(name: BacktestTableName) {
    if (!this.registered.has(name)) throw new Error(`回测结果尚未加载: ${name}`);
    return this.database.rows(`SELECT * FROM read_parquet(${literal(this.files[name])})`);
  }

  private tableSummary(name: BacktestTableName, file: string, where: string, schema: BacktestTableSchema) {
    const key = `${name}\u0000${where}`;
    const cached = this.summaryCache.get(key);
    if (cached) return cached;

    const columns = Object.entries(backtestTableConfigs[name]).flatMap(([column, config]) => schema.columnSet.has(column) && (config.type === "integer" || config.type === "number") ? [column] : []);
    const request = Promise.all([
      this.database.rows(`SELECT count(*) AS total FROM read_parquet(${literal(file)}) ${where}`),
      readParquetNumericColumnStats(this.database, file, columns, where)
    ]).then(([totalRows, numericStats]) => ({ numericStats, total: Math.max(0, Math.trunc(numberValue(totalRows[0]?.total) ?? 0)) }));
    rememberSummary(this.summaryCache, key, request);
    request.catch(() => { if (this.summaryCache.get(key) === request) this.summaryCache.delete(key); });
    return request;
  }

  private async readSchema(name: BacktestTableName) {
    const rows = await this.database.rows(`DESCRIBE SELECT * FROM read_parquet(${literal(this.files[name])})`);
    const actualColumns = rows.map((row) => String(row.column_name));
    const actualColumnSet = new Set(actualColumns);
    const timeColumn = backtestTableTimeColumns[name];
    if (!actualColumnSet.has(timeColumn)) throw new Error(`回测结果 ${name} 缺少必需时间列: ${timeColumn}`);
    this.schemas.set(name, {
      columns: Object.keys(backtestTableConfigs[name]).filter((column) => actualColumnSet.has(column)),
      columnSet: actualColumnSet
    });
  }

  private schema(name: BacktestTableName) {
    const schema = this.schemas.get(name);
    if (!schema) throw new Error(`回测结果尚未读取结构: ${name}`);
    return schema;
  }

  close() {
    return this.database.close();
  }
}

function literal(value: string) { return `'${value.replace(/'/g, "''")}'`; }
function identifier(value: string) { return `"${value.replace(/"/g, "\"\"")}"`; }
function numberValue(value: unknown) { if (value === null || value === undefined) return null; const number = Number(value); return Number.isFinite(number) ? number : null; }

function tableWhere(name: BacktestTableName, range: BacktestDateRange, filters: ParquetColumnFilterState[], columns: ReadonlySet<string>) {
  const predicates = [`CAST(${identifier(backtestTableTimeColumns[name])} AS DATE) BETWEEN DATE ${literal(range.start)} AND DATE ${literal(range.end)}`];
  filters.forEach((filter) => {
    if (!columns.has(filter.id)) return;
    const config = backtestTableConfigs[name][filter.id];
    if (!config?.filter) return;
    if (config.filter === "date") predicates.push(`contains(CAST(${identifier(filter.id)} AS VARCHAR), ${literal(String(filter.value))})`);
    else if (config.filter === "text") predicates.push(`contains(lower(CAST(${identifier(filter.id)} AS VARCHAR)), lower(${literal(String(filter.value))}))`);
    else if (config.filter === "enum" && config.enum?.[String(filter.value)]) predicates.push(`CAST(${identifier(filter.id)} AS VARCHAR) = ${literal(String(filter.value))}`);
  });
  return `WHERE ${predicates.join(" AND ")}`;
}

function tableOrderBy(name: BacktestTableName, query: ParquetTableQuery, columns: ReadonlySet<string>) {
  const sorts = query.sorting.flatMap((sort) => columns.has(sort.id) && backtestTableConfigs[name][sort.id]?.sortable ? [`${identifier(sort.id)} ${sort.desc ? "DESC" : "ASC"} NULLS LAST`] : []).slice(0, 3);
  if (!sorts.length) sorts.push(`${identifier(backtestTableTimeColumns[name])} ASC NULLS LAST`);
  return `ORDER BY ${sorts.join(", ")}`;
}

function rememberSummary<T>(cache: Map<string, Promise<T>>, key: string, request: Promise<T>) {
  cache.set(key, request);
  while (cache.size > maximumSummaryCacheEntries) cache.delete(cache.keys().next().value!);
}
