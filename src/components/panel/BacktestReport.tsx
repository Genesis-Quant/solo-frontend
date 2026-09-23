import { Loader2 } from "lucide-react";
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { max as statisticsMax, mean as statisticsMean, sum } from "simple-statistics";

import { backtestApi } from "@/assets/lib/reportFixture";
import { BacktestAnalytics, backtestTableTimeColumns, type BacktestTableName, type BacktestTablePage, type PortfolioPoint } from "@/assets/lib/backtestAnalysis";
import { backtestTableConfigs } from "@/assets/lib/backtestTable";
import { chartRange, chartRangeIncluding, formatAxisLabel, thresholdMarkLine } from "@/assets/lib/chart";
import { quantStatsReport, type DrawdownPeriod, type QuantStatsReport } from "@/assets/lib/quantstats";
import DateRangeBar from "@/components/bar/DateRangeBar";
import EChart from "@/components/chart/EChart";
import SortableCardStack from "@/components/layout/SortableCardStack";
import ParquetDataTable from "@/components/table/ParquetDataTable";
import { useAppStore } from "@/store";
import type { AxisFormat, BacktestChartRanges, ChartRange } from "@/types/chart";
import { emptyParquetTableQuery, type ParquetTableQuery } from "@/types/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";

const tableTabs = [
  { value: "trade_details", label: "交易记录" },
  { value: "daily_positions", label: "每日持仓" },
  { value: "daily_portfolios", label: "组合资产" },
  { value: "daily_trading_statistics", label: "交易统计" }
] as const;

type MetricFormat = "decimal" | "percent" | "integer" | "currency";
type Metric = { label: string; value: number | null; format?: MetricFormat };
type BacktestReportProps = {
  activeTab?: string;
  annualTradingDays: number;
  chartRanges?: BacktestChartRanges;
  onActiveTabChange?: (value: string) => void;
  onChartRanges?: (ranges: BacktestChartRanges) => void;
  riskFreeRate: number;
  showTabs?: boolean;
  workflowInstanceId: number;
};

export default function BacktestReport({ activeTab, annualTradingDays, chartRanges, onActiveTabChange, onChartRanges, riskFreeRate, showTabs = true, workflowInstanceId }: BacktestReportProps) {
  const theme = useAppStore((state) => state.theme);
  const analytics = useRef<BacktestAnalytics | null>(null);
  const [localTab, setLocalTab] = useState("overview");
  const [portfolio, setPortfolio] = useState<PortfolioPoint[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(20);
  const [tableQuery, setTableQuery] = useState<ParquetTableQuery>(emptyParquetTableQuery);
  const [tableData, setTableData] = useState<BacktestTablePage | null>(null);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableError, setTableError] = useState("");
  const selectedTab = activeTab ?? localTab;
  const tableName = isBacktestTableName(selectedTab) ? selectedTab : null;
  const tableRequestKey = createTableRequestKey(workflowInstanceId, tableName, startDate, endDate, tablePage, tablePageSize, tableQuery);
  const [tableLoadedKey, setTableLoadedKey] = useState("");

  const loadRawTable = useCallback(async (name: BacktestTableName) => {
    const instance = analytics.current;
    if (!instance) throw new Error("回测结果尚未加载");
    return instance.rawTable(name);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    backtestApi.output(workflowInstanceId, "daily_portfolios")
      .then(async (dailyPortfolios) => {
        const instance = await BacktestAnalytics.create(workflowInstanceId, dailyPortfolios);
        if (cancelled) { await instance.close(); return; }
        analytics.current = instance;
        const nextPortfolio = await instance.portfolios();
        if (cancelled) return;
        setPortfolio(nextPortfolio);
        setStartDate(nextPortfolio[0]?.time ?? "");
        setEndDate(nextPortfolio.at(-1)?.time ?? "");
      })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; const instance = analytics.current; analytics.current = null; instance?.close(); };
  }, [workflowInstanceId]);

  useEffect(() => {
    const activeInstance = analytics.current;
    if (!tableName || !activeInstance || loading || error || !startDate || !endDate) return undefined;
    const instance = activeInstance;
    const name = tableName;
    const requestKey = tableRequestKey;
    let cancelled = false;
    setTableLoading(true);
    setTableError("");
    async function loadTable() {
      if (!instance.isRegistered(name)) await instance.register(name, await backtestApi.output(workflowInstanceId, name));
      const result = await instance.tablePage(name, tablePage, tablePageSize, { start: startDate, end: endDate }, tableQuery);
      if (!cancelled) { setTableData(result); setTableLoadedKey(requestKey); }
    }
    loadTable().catch((reason) => { if (!cancelled) { setTableError(reason instanceof Error ? reason.message : String(reason)); setTableLoadedKey(requestKey); } }).finally(() => { if (!cancelled) setTableLoading(false); });
    return () => { cancelled = true; };
  }, [endDate, error, loading, startDate, tableName, tablePage, tablePageSize, tableQuery, tableRequestKey, workflowInstanceId]);

  const selectedPortfolio = useMemo(() => portfolio.filter((row) => (!startDate || row.time >= startDate) && (!endDate || row.time <= endDate)), [endDate, portfolio, startDate]);
  const rangePoints = useMemo(() => portfolio.map((row) => ({ time: row.time, value: row.dailyReturn })), [portfolio]);
  const report = useMemo(() => createReport(selectedPortfolio, annualTradingDays, riskFreeRate, selectedPortfolio[0]?.time === portfolio[0]?.time), [annualTradingDays, portfolio, riskFreeRate, selectedPortfolio]);

  useEffect(() => {
    if (!onChartRanges || !report) return;
    onChartRanges({
      netValue: chartRange([
        ...report.netValue.map((row) => row.value),
        ...benchmarkValues(selectedPortfolio).filter((value): value is number => value !== null)
      ]),
      totalEquity: chartRange(selectedPortfolio.map((row) => row.totalEquity)),
      drawdown: chartRange(report.drawdown.map((row) => row.value), true),
      rollingSharpe: chartRange(report.rollingSharpe.map((row) => row.value), true)
    });
  }, [onChartRanges, report, selectedPortfolio]);

  const overview = renderOverview({ chartRanges, error, loading, portfolio: selectedPortfolio, report, theme });

  const tableContent = tableName ? renderParquetContent({ data: tableData, download: { fileName: `backtest-${workflowInstanceId}-${tableName}.xlsx`, loadRows: () => loadRawTable(tableName) }, error: tableLoadedKey === tableRequestKey ? tableError : "", loading: tableLoading || tableLoadedKey !== tableRequestKey, name: tableName, page: tablePage, pageSize: tablePageSize, query: tableQuery, onPage: setTablePage, onPageSize: (nextPageSize) => { setTablePage(1); setTablePageSize(nextPageSize); }, onQuery: (nextQuery) => { setTablePage(1); setTableQuery(nextQuery); } }) : null;

  return <Tabs value={selectedTab} onValueChange={(value) => { setTablePage(1); setTableQuery(emptyParquetTableQuery()); setLocalTab(value); onActiveTabChange?.(value); }} className="relative">
    {showTabs ? <div className="sticky top-0 z-30 mb-2 max-w-full overflow-x-auto bg-background pb-2"><TabsList className="w-max"><TabsTrigger value="overview">回测概览</TabsTrigger>{tableTabs.map((tab) => <TabsTrigger disabled={loading || Boolean(error)} key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>)}</TabsList></div> : null}
    {!loading && !error && portfolio.length ? <DateRangeBar endDate={endDate} maximumDate={portfolio.at(-1)?.time ?? ""} minimumDate={portfolio[0]?.time ?? ""} points={rangePoints} startDate={startDate} theme={theme} onRangeChange={(nextStartDate, nextEndDate) => { setTablePage(1); setStartDate(nextStartDate); setEndDate(nextEndDate); }} onReset={() => { setTablePage(1); setStartDate(portfolio[0]?.time ?? ""); setEndDate(portfolio.at(-1)?.time ?? ""); }} /> : null}
    <TabsContent value="overview" className="space-y-4">{overview}</TabsContent>
    {tableTabs.map((tab) => <TabsContent className="min-h-[calc(100dvh-20rem)]" key={tab.value} value={tab.value}>{selectedTab === tab.value ? tableContent : null}</TabsContent>)}
  </Tabs>;
}

function ReportOverview({ chartRanges, portfolio, report, theme }: { chartRanges?: BacktestChartRanges; portfolio: PortfolioPoint[]; report: QuantStatsReport; theme: string }) {
  const returnMetrics = [
    { label: "累计收益", value: report.totalReturn, format: "percent" },
    { label: "年化收益", value: report.cagr, format: "percent" },
    { label: "年化 Sharpe", value: report.sharpe },
    { label: "年化波动", value: report.volatility, format: "percent" }
  ] satisfies Metric[];
  const periods = [...report.drawdownPeriods].sort((left, right) => left.maxDrawdownPercent - right.maxDrawdownPercent);
  const drawdownMetrics = [
    { label: "平均回撤", value: periods.length ? statisticsMean(periods.map((row) => row.maxDrawdownPercent)) / 100 : null, format: "percent" },
    { label: "平均回撤持续天数", value: periods.length ? statisticsMean(periods.map((row) => row.days)) : null, format: "integer" },
    { label: "恢复因子", value: report.recoveryFactor },
    { label: "收益/痛苦比率", value: report.gainToPainRatio }
  ] satisfies Metric[];

  return <SortableCardStack
    storageKey="solo.prototype.backtest.overview-card-order"
    items={[
      {
        id: "returns",
        content: <ReportCard title="收益分析">
          <MetricGrid metrics={returnMetrics} />
          <MetricGrid metrics={feeMetrics(portfolio)} />
          <ChartCard title="策略、基准净值与总资产"><EChart height={360} option={portfolioOption(portfolio, report, theme, chartRanges)} /></ChartCard>
          <ChartCard title="滚动年化 Sharpe"><EChart height={340} option={rollingSharpeOption(report, theme, chartRanges?.rollingSharpe)} /></ChartCard>
          <PerformanceTable report={report} />
        </ReportCard>
      },
      {
        id: "drawdown",
        content: <ReportCard title="回撤分析">
          <MetricGrid metrics={drawdownMetrics} />
          <ChartCard title="回撤曲线"><EChart height={340} option={drawdownOption(report, theme, chartRanges?.drawdown)} /></ChartCard>
          <DrawdownTable rows={periods.slice(0, 5)} />
        </ReportCard>
      }
    ]}
  />;
}

function renderOverview({ chartRanges, error, loading, portfolio, report, theme }: { chartRanges?: BacktestChartRanges; error: string; loading: boolean; portfolio: PortfolioPoint[]; report: QuantStatsReport | null; theme: string }): ReactNode {
  if (loading) return <ReportLoading />;
  if (error) return <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>;
  if (!report) return <div className="rounded-md border py-10 text-center text-sm text-muted-foreground">所选日期范围内暂无回测数据</div>;
  return <ReportOverview chartRanges={chartRanges} portfolio={portfolio} report={report} theme={theme} />;
}

function ReportCard({ children, title }: { children: ReactNode; title: string }) { return <Card className="rounded-md py-5 shadow-sm"><CardHeader className="px-5 pb-2 pr-14"><CardTitle className="text-base font-semibold">{title}</CardTitle></CardHeader><CardContent className="space-y-4 px-5">{children}</CardContent></Card>; }
function ChartCard({ children, title }: { children: ReactNode; title: ReactNode }) { return <Card className="rounded-md py-4 shadow-sm"><CardHeader className="px-4 pb-2"><CardTitle className="text-sm font-medium">{title}</CardTitle></CardHeader><CardContent className="px-4">{children}</CardContent></Card>; }
function MetricGrid({ metrics }: { metrics: Metric[] }) { return <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{metrics.map((metric) => <div className="rounded-md border bg-card px-4 py-3 shadow-sm" key={metric.label}><div className="text-xs text-muted-foreground">{metric.label}</div><p className="mt-2 text-lg font-semibold tabular-nums tracking-tight">{formatMetric(metric.value, metric.format)}</p></div>)}</div>; }
function ReportLoading() { return <div className="grid min-h-80 place-items-center rounded-md border bg-card"><div className="text-center"><Loader2 className="mx-auto animate-spin text-primary" /><p className="mt-3 text-sm text-muted-foreground">DuckDB 正在读取回测结果...</p></div></div>; }

function PerformanceTable({ report }: { report: QuantStatsReport }) {
  const longestDrawdown = report.drawdownPeriods.length ? statisticsMax(report.drawdownPeriods.map((row) => row.days)) : null;
  const rows = [
    { label: "累计收益率", value: report.totalReturn, format: "percent" },
    { label: "年化收益率", value: report.cagr, format: "percent" },
    { label: "年化 Sharpe", value: report.sharpe },
    { label: "最大回撤", value: report.maxDrawdown, format: "percent" },
    { label: "年化 Sortino", value: report.sortino },
    { label: "年化波动率", value: report.volatility, format: "percent" },
    { label: "Calmar 比率", value: report.calmar },
    { label: "盈亏比", value: report.payoffRatio },
    { label: "平均日收益率", value: report.averageReturn, format: "percent" },
    { label: "最大连续亏损交易日", value: report.maxConsecutiveLosses, format: "integer" },
    { label: "盈利因子", value: report.profitFactor },
    { label: "恢复因子", value: report.recoveryFactor },
    { label: "日历年收益几何均值", value: report.expectedAnnualReturn, format: "percent" },
    { label: "最长回撤持续天数", value: longestDrawdown, format: "integer" },
    { label: "日收益偏度", value: report.skew },
    { label: "日收益峰度", value: report.kurtosis },
    { label: "日风险价值（95%）", value: report.valueAtRisk, format: "percent" },
    { label: "日预期短缺（95%）", value: report.conditionalValueAtRisk, format: "percent" },
    { label: "日胜率", value: report.winRate, format: "percent" },
    { label: "收益/痛苦比率", value: report.gainToPainRatio }
  ] satisfies Metric[];
  const groupedRows = Array.from({ length: Math.ceil(rows.length / 3) }, (_, index) => rows.slice(index * 3, index * 3 + 3));
  return <div className="max-h-[440px] overflow-auto rounded-md border"><Table><TableHeader className="sticky top-0 z-10 bg-muted/90 backdrop-blur"><TableRow>{[0, 1, 2].map((column) => <Fragment key={column}><TableHead>指标</TableHead><TableHead className="text-right">策略</TableHead></Fragment>)}</TableRow></TableHeader><TableBody>{groupedRows.map((group, rowIndex) => <TableRow key={rowIndex}>{[0, 1, 2].map((column) => { const metric = group[column]; return <Fragment key={metric?.label ?? column}><TableCell>{metric?.label ?? ""}</TableCell><TableCell className="text-right font-mono tabular-nums">{metric ? formatMetric(metric.value, metric.format) : ""}</TableCell></Fragment>; })}</TableRow>)}</TableBody></Table></div>;
}

function DrawdownTable({ rows }: { rows: DrawdownPeriod[] }) {
  if (!rows.length) return <div className="rounded-md border py-8 text-center text-sm text-muted-foreground">暂无回撤区间</div>;
  return <div className="overflow-auto rounded-md border"><Table><TableHeader className="bg-muted/70"><TableRow><TableHead>开始</TableHead><TableHead>谷底</TableHead><TableHead>结束</TableHead><TableHead className="text-right">天数</TableHead><TableHead className="text-right">最大回撤</TableHead><TableHead className="text-right">99% 最大回撤</TableHead></TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={`${row.start}-${row.end}`}><TableCell>{row.start}</TableCell><TableCell>{row.valley}</TableCell><TableCell>{row.end}</TableCell><TableCell className="text-right tabular-nums">{row.days}</TableCell><TableCell className="text-right font-mono tabular-nums">{formatMetric(row.maxDrawdownPercent / 100, "percent")}</TableCell><TableCell className="text-right font-mono tabular-nums">{formatMetric(row.maxDrawdown99Percent / 100, "percent")}</TableCell></TableRow>)}</TableBody></Table></div>;
}

function renderParquetContent({ data, download, error, loading, name, onPage, onPageSize, onQuery, page, pageSize, query }: { data: BacktestTablePage | null; download: { fileName: string; loadRows: () => Promise<Record<string, unknown>[]> }; error: string; loading: boolean; name: BacktestTableName; onPage: (page: number) => void; onPageSize: (pageSize: number) => void; onQuery: (query: ParquetTableQuery) => void; page: number; pageSize: number; query: ParquetTableQuery }): ReactNode {
  if (loading && !data) return <div className="grid min-h-64 place-items-center rounded-md border bg-card"><Loader2 className="animate-spin text-primary" /></div>;
  if (error) return <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>;
  if (!data) return null;
  return <ParquetDataTable columnConfigs={backtestTableConfigs[name]} columns={data.columns} containerClassName="max-h-[calc(100dvh-20rem)]" download={download} loading={loading} numericStats={data.numericStats} pagination={{ page, pageSize, total: data.total, onPageChange: onPage, onPageSizeChange: onPageSize }} query={{ value: query, onChange: onQuery }} rows={data.rows} timeColumn={backtestTableTimeColumns[name]} />;
}

function createReport(rows: PortfolioPoint[], periods: number, riskFreeRate: number, excludeInitialReturn: boolean) { return rows.length ? quantStatsReport(rows.map((row) => ({ time: row.time, value: row.dailyReturn ?? 0 })), periods, riskFreeRate, excludeInitialReturn) : null; }

function feeMetrics(rows: PortfolioPoint[]): Metric[] {
  const fees = rows.map((row) => row.dailyFee).filter((value): value is number => value !== null && value >= 0);
  const paid = fees.filter((value) => value > 0);
  const total = sum(fees);
  const first = rows[0];
  const initialCapital = first?.totalEquity !== null && first?.netValue !== null && first.netValue > 0 ? first.totalEquity / first.netValue : null;
  return [
    { label: "累计手续费", value: fees.length ? total : null, format: "currency" },
    { label: "平均交易日手续费", value: paid.length ? statisticsMean(paid) : fees.length ? 0 : null, format: "currency" },
    { label: "最大单日手续费", value: fees.length ? statisticsMax(fees) : null, format: "currency" },
    { label: "手续费占初始资金", value: initialCapital ? total / initialCapital : null, format: "percent" }
  ];
}

function formatMetric(value: number | null | undefined, format: MetricFormat = "decimal") {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (!Number.isFinite(value)) return value > 0 ? "∞" : "−∞";
  if (format === "percent") return `${(value * 100).toFixed(2)}%`;
  if (format === "integer") return Math.round(value).toLocaleString("zh-CN");
  if (format === "currency") return `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return value.toFixed(3);
}

function isBacktestTableName(value: string): value is BacktestTableName { return tableTabs.some((tab) => tab.value === value); }
function createTableRequestKey(workflowInstanceId: number, name: BacktestTableName | null, startDate: string, endDate: string, page: number, pageSize: number, query: ParquetTableQuery) { return name ? `${workflowInstanceId}:${name}:${startDate}:${endDate}:${page}:${pageSize}:${JSON.stringify(query)}` : ""; }
function portfolioOption(rows: PortfolioPoint[], report: QuantStatsReport, theme: string, ranges?: BacktestChartRanges) { const benchmark = benchmarkValues(rows); const series: Record<string, unknown>[] = [{ name: "策略净值", type: "line", data: report.netValue.map((row) => row.value), showSymbol: false, lineStyle: { width: 2.2 }, color: "#2563eb" }]; if (benchmark.some((value) => value !== null)) series.push({ name: "基准净值", type: "line", data: benchmark, showSymbol: false, lineStyle: { width: 1.8 }, color: "#d97706" }); series.push({ name: "总资产", type: "line", yAxisIndex: 1, data: rows.map((row) => row.totalEquity), showSymbol: false, lineStyle: { width: 1.5 }, color: "#059669" }); return baseOption(theme, rows.map((row) => row.time), series, ranges?.netValue, ranges?.totalEquity, true, "decimal", "integer"); }
function benchmarkValues(rows: PortfolioPoint[]) { const base = rows.find((row) => row.benchmarkNetValue !== null && row.benchmarkNetValue > 0)?.benchmarkNetValue; return rows.map((row) => base && row.benchmarkNetValue !== null ? row.benchmarkNetValue / base : null); }
function drawdownOption(report: QuantStatsReport, theme: string, range?: ChartRange) { return baseOption(theme, report.drawdown.map((row) => row.time), [{ name: "回撤", type: "line", data: report.drawdown.map((row) => row.value), showSymbol: false, lineStyle: { width: 2 }, areaStyle: { opacity: 0.12 }, color: "#dc2626" }], range, undefined, false, "percent"); }
function rollingSharpeOption(report: QuantStatsReport, theme: string, range?: ChartRange) { return baseOption(theme, report.rollingSharpe.map((row) => row.time), [{ name: "滚动年化 Sharpe", type: "line", data: report.rollingSharpe.map((row) => row.value), showSymbol: false, lineStyle: { width: 1.8 }, color: "#d97706", markLine: thresholdMarkLine(theme, "Sharpe = 0.5", 0.5) }], chartRangeIncluding(range, 0.5)); }
function baseOption(theme: string, dates: string[], series: unknown[], primaryRange?: ChartRange, secondaryRange?: ChartRange, dualAxis = false, primaryFormat: AxisFormat = "decimal", secondaryFormat: AxisFormat = "decimal") { const color = theme === "dark" ? "#8996a5" : "#687771"; const line = theme === "dark" ? "rgba(160,184,210,.10)" : "rgba(24,66,54,.10)"; const axis = (range?: ChartRange, format: AxisFormat = "decimal") => ({ type: "value", scale: true, min: range?.min, max: range?.max, axisLabel: { color, fontSize: 9, formatter: (value: number) => formatAxisLabel(value, format) }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: line } } }); return { animationDuration: 180, grid: { left: 48, right: dualAxis ? 58 : 28, top: 42, bottom: 38, containLabel: true }, legend: { top: 0, left: 0, textStyle: { color, fontSize: 10 } }, tooltip: { trigger: "axis", backgroundColor: theme === "dark" ? "#151b24" : "#fff", borderColor: line, textStyle: { color: theme === "dark" ? "#eef4f7" : "#13201d", fontSize: 11 } }, xAxis: { type: "category", data: dates, boundaryGap: false, axisLine: { lineStyle: { color: line } }, axisLabel: { color, fontSize: 9, hideOverlap: true }, axisTick: { show: false } }, yAxis: dualAxis ? [axis(primaryRange, primaryFormat), { ...axis(secondaryRange, secondaryFormat), splitLine: { show: false } }] : axis(primaryRange, primaryFormat), series } as Record<string, unknown>; }
