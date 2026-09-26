import { useEffect, useMemo, useRef, useState } from "react";
import ttest from "@stdlib/stats-ttest";
import { motion } from "motion/react";
import {
  mean as statisticsMean,
  sampleStandardDeviation,
  standardDeviation
} from "simple-statistics";
import IconDatabase from "~icons/lucide/database";
import IconLoaderCircle from "~icons/lucide/loader-circle";

import { useReportApi } from "@/assets/lib/reports";
import { chartRange, formatAxisLabel, thresholdMarkLine } from "@/assets/lib/chart";
import { errorMessage } from "@/assets/lib/utils";
import {
  FactorAnalytics,
  type DecayPoint,
  type ExecutionStatisticPoint,
  type GroupPoint,
  type GroupStatistic,
  type InformationPoint,
  type LongShortPoint,
  type TurnoverSummary
} from "@/assets/lib/factorAnalysis";
import DateRangeBar from "@/components/bar/DateRangeBar";
import EChart from "@/components/chart/EChart";
import SortableCardStack from "@/components/card/SortableCardStack";
import { useAppStore } from "@/store";
import type { AxisFormat, ChartRange, FactorChartRanges } from "@/types/chart";
import type { FactorMetrics, FactorReportParameters } from "@/types/factor";
import { Button } from "@/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/ui/tabs";

type DualChartRanges = { primary?: ChartRange; secondary?: ChartRange };
type DisplayMetric = { label: string; value: string };

const IC_MOVING_AVERAGE_WINDOW = 22;
const executionPercentageFormatter = new Intl.NumberFormat("zh-CN", {
  style: "percent",
  maximumFractionDigits: 2
});

type FactorAnalysisReportProps = {
  chartRanges?: FactorChartRanges;
  factor: string;
  parameters: FactorReportParameters;
  workflowInstanceId: number;
  onChartRanges?: (ranges: FactorChartRanges) => void;
};

type IcType = "RankIC" | "IC";
export default function FactorAnalysisReport({ chartRanges, factor, onChartRanges, parameters, workflowInstanceId }: FactorAnalysisReportProps) {
  const factorApi = useReportApi();
  const theme = useAppStore((state) => state.theme);
  const analytics = useRef<FactorAnalytics | null>(null);
  const factorColumnsKey = parameters.factor_columns.join("\u0001");
  const returnColumnsKey = parameters.return_columns.join("\u0001");
  const firstReturnColumn = parameters.return_columns[0];
  const [metrics, setMetrics] = useState<FactorMetrics | null>(null);
  const [icReturnColumn, setIcReturnColumn] = useState(firstReturnColumn);
  const [returnColumn, setReturnColumn] = useState(firstReturnColumn);
  const [groupReturnColumn, setGroupReturnColumn] = useState(firstReturnColumn);
  const [icType, setIcType] = useState<IcType>("RankIC");
  const [information, setInformation] = useState<InformationPoint[]>([]);
  const [longShort, setLongShort] = useState<LongShortPoint[]>([]);
  const [groups, setGroups] = useState<GroupPoint[]>([]);
  const [reverseGroups, setReverseGroups] = useState(false);
  const displayedGroups = useMemo(() => groupChartPoints(groups, reverseGroups), [groups, reverseGroups]);
  const [groupStatistics, setGroupStatistics] = useState<GroupStatistic[]>([]);
  const [decay, setDecay] = useState<DecayPoint[]>([]);
  const [executionStatistics, setExecutionStatistics] = useState<ExecutionStatisticPoint[]>([]);
  const [turnoverPeriods, setTurnoverPeriods] = useState<number[]>([]);
  const [turnoverPeriod, setTurnoverPeriod] = useState<number | null>(null);
  const [turnover, setTurnover] = useState<TurnoverSummary | null>(null);
  const [timeline, setTimeline] = useState<Array<{ time: string; value: number | null }>>([]);
  const [rangeFactor, setRangeFactor] = useState("");
  const [minimumDate, setMinimumDate] = useState("");
  const [maximumDate, setMaximumDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [informationLoading, setInformationLoading] = useState(false);
  const [returnLoading, setReturnLoading] = useState(false);
  const [groupLoading, setGroupLoading] = useState(false);
  const [decayLoading, setDecayLoading] = useState(false);
  const [executionStatisticsLoading, setExecutionStatisticsLoading] = useState(false);
  const [turnoverLoading, setTurnoverLoading] = useState(false);
  const [error, setError] = useState("");
  const rangePoints = timeline;
  const returnSpecsKey = JSON.stringify(parameters.return_specs);
  const icReturnSpec = parameters.return_specs[icReturnColumn];
  const returnSpec = parameters.return_specs[returnColumn];
  const groupReturnSpec = parameters.return_specs[groupReturnColumn];
  const returnPeriods = returnPeriodsOf(parameters, returnColumn);
  const groupReturnPeriods = returnPeriodsOf(parameters, groupReturnColumn);

  useEffect(() => {
    if (!parameters.return_columns.includes(icReturnColumn)) setIcReturnColumn(firstReturnColumn);
    if (!parameters.return_columns.includes(returnColumn)) setReturnColumn(firstReturnColumn);
    if (!parameters.return_columns.includes(groupReturnColumn)) setGroupReturnColumn(firstReturnColumn);
  }, [firstReturnColumn, groupReturnColumn, icReturnColumn, parameters.return_columns, returnColumn]);

  useEffect(() => {
    let cancelled = false;
    let session: FactorAnalytics | null = null;
    setLoading(true);
    setError("");
    setMetrics(null);
    setExecutionStatistics([]);
    async function loadResults() {
      try {
        const outputs = await factorApi.outputs();
        const available = new Set(outputs.map((output) => output.name));
        const missingRequired = ["information_coefficient", "group_returns"].filter((name) => !available.has(name as "information_coefficient" | "group_returns"));
        if (missingRequired.length) throw new Error(`工作流缺少因子报告必需结果：${missingRequired.join(", ")}`);
        const [informationBuffer, groupBuffer, turnoverBuffer, executionStatisticsBuffer] = await Promise.all([
          factorApi.output(workflowInstanceId, "information_coefficient"),
          factorApi.output(workflowInstanceId, "group_returns"),
          available.has("group_turnover") ? factorApi.output(workflowInstanceId, "group_turnover") : Promise.resolve(null),
          available.has("execution_statistics") ? factorApi.output(workflowInstanceId, "execution_statistics") : Promise.resolve(null)
        ]);
        session = await FactorAnalytics.create(
          workflowInstanceId,
          { information: informationBuffer, groups: groupBuffer, turnover: turnoverBuffer, executionStatistics: executionStatisticsBuffer },
          parameters
        );
        if (cancelled) {
          await session.close();
          return;
        }
        analytics.current = session;
        const calculated = await session.metrics();
        if (cancelled) return;
        setMetrics(calculated);
      } catch (reason) {
        if (!cancelled) setError(errorMessage(reason));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadResults();
    return () => {
      cancelled = true;
      if (analytics.current === session) analytics.current = null;
      session?.close().catch(() => undefined);
    };
  }, [factorApi, factorColumnsKey, parameters.n_groups, parameters.n_select, returnColumnsKey, returnSpecsKey, workflowInstanceId]);

  useEffect(() => {
    const session = analytics.current;
    if (!session || !metrics || !factor || !firstReturnColumn) return undefined;
    let cancelled = false;
    setRangeFactor("");
    Promise.all([
      session.dateRange(factor, firstReturnColumn),
      session.informationSeries(factor, firstReturnColumn),
      session.executionStatistics()
    ])
      .then(([range, rows, statistics]) => {
        if (cancelled) return;
        const nextTimeline = statistics.length
          ? statistics.map((row) => ({ time: row.time, value: row.retentionRate }))
          : rows.map((row) => ({ time: row.time, value: row.rankIc ?? row.ic }));
        const nextMinimum = nextTimeline[0]?.time ?? range.start;
        const nextMaximum = nextTimeline.at(-1)?.time ?? range.end;
        setTimeline(nextTimeline);
        setExecutionStatistics(statistics);
        setMinimumDate(nextMinimum);
        setMaximumDate(nextMaximum);
        setStartDate(nextMinimum);
        setEndDate(nextMaximum);
        setRangeFactor(factor);
      })
      .catch((reason) => { if (!cancelled) setError(errorMessage(reason)); });
    return () => { cancelled = true; };
  }, [factor, firstReturnColumn, metrics]);

  useEffect(() => {
    const session = analytics.current;
    if (!session || !metrics || !factor || !icReturnColumn || rangeFactor !== factor) return undefined;
    let cancelled = false;
    setInformationLoading(true);
    session.informationSeries(factor, icReturnColumn, { start: startDate, end: endDate })
      .then((rows) => { if (!cancelled) setInformation(rows); })
      .catch((reason) => { if (!cancelled) setError(errorMessage(reason)); })
      .finally(() => { if (!cancelled) setInformationLoading(false); });
    return () => { cancelled = true; };
  }, [endDate, factor, icReturnColumn, metrics, rangeFactor, startDate]);

  useEffect(() => {
    const session = analytics.current;
    if (!session || !metrics || !factor || !returnColumn || rangeFactor !== factor) return undefined;
    let cancelled = false;
    setReturnLoading(true);
    session.longShortSeries(factor, returnColumn, { start: startDate, end: endDate })
      .then((rows) => { if (!cancelled) setLongShort(rows); })
      .catch((reason) => { if (!cancelled) setError(errorMessage(reason)); })
      .finally(() => { if (!cancelled) setReturnLoading(false); });
    return () => { cancelled = true; };
  }, [endDate, factor, metrics, parameters.n_groups, rangeFactor, returnColumn, startDate]);

  useEffect(() => {
    const session = analytics.current;
    if (!session || !metrics || !factor || rangeFactor !== factor) return undefined;
    let cancelled = false;
    setExecutionStatisticsLoading(true);
    session.executionStatistics({ start: startDate, end: endDate })
      .then((rows) => { if (!cancelled) setExecutionStatistics(rows); })
      .catch((reason) => { if (!cancelled) setError(errorMessage(reason)); })
      .finally(() => { if (!cancelled) setExecutionStatisticsLoading(false); });
    return () => { cancelled = true; };
  }, [endDate, factor, metrics, rangeFactor, startDate]);

  useEffect(() => {
    const session = analytics.current;
    if (!session || !metrics || !factor || !groupReturnColumn || rangeFactor !== factor) return undefined;
    let cancelled = false;
    setGroupLoading(true);
    Promise.all([
      groupReturnPeriods === 1
        ? session.groupSeries(factor, groupReturnColumn, parameters.n_groups, { start: startDate, end: endDate })
        : Promise.resolve([]),
      session.groupStatistics(factor, groupReturnColumn, parameters.n_groups, { start: startDate, end: endDate })
    ])
      .then(([series, statistics]) => {
        if (cancelled) return;
        setGroups(series);
        setGroupStatistics(statistics);
      })
      .catch((reason) => { if (!cancelled) setError(errorMessage(reason)); })
      .finally(() => { if (!cancelled) setGroupLoading(false); });
    return () => { cancelled = true; };
  }, [endDate, factor, groupReturnColumn, groupReturnPeriods, metrics, parameters.n_groups, parameters.n_select, rangeFactor, startDate]);

  useEffect(() => {
    const session = analytics.current;
    if (!session || !metrics || !factor || rangeFactor !== factor) return undefined;
    let cancelled = false;
    setDecayLoading(true);
    session.decay(factor, parameters.return_columns, { start: startDate, end: endDate })
      .then((rows) => { if (!cancelled) setDecay(rows); })
      .catch((reason) => { if (!cancelled) setError(errorMessage(reason)); })
      .finally(() => { if (!cancelled) setDecayLoading(false); });
    return () => { cancelled = true; };
  }, [endDate, factor, metrics, rangeFactor, returnColumnsKey, startDate]);

  useEffect(() => {
    const session = analytics.current;
    if (!session || !metrics || !factor) return undefined;
    let cancelled = false;
    setTurnoverPeriods([]);
    setTurnoverPeriod(null);
    setTurnover(null);
    session.turnoverPeriods(factor)
      .then((periods) => {
        if (cancelled) return;
        setTurnoverPeriods(periods);
        setTurnoverPeriod(periods[0] ?? null);
      })
      .catch((reason) => { if (!cancelled) setError(errorMessage(reason)); });
    return () => { cancelled = true; };
  }, [factor, metrics]);

  useEffect(() => {
    const session = analytics.current;
    if (!session || !metrics || !factor || turnoverPeriod === null || rangeFactor !== factor) return undefined;
    let cancelled = false;
    setTurnover(null);
    setTurnoverLoading(true);
    session.turnoverSummary(factor, turnoverPeriod, parameters.n_groups, { start: startDate, end: endDate })
      .then((summary) => { if (!cancelled) setTurnover(summary); })
      .catch((reason) => { if (!cancelled) setError(errorMessage(reason)); })
      .finally(() => { if (!cancelled) setTurnoverLoading(false); });
    return () => { cancelled = true; };
  }, [endDate, factor, metrics, parameters.n_groups, rangeFactor, startDate, turnoverPeriod]);

  useEffect(() => {
    if (!onChartRanges) return;
    onChartRanges({
      executionStatistics: chartRange(executionStatistics.map((row) => row.sourceCount), true),
      information: {
        primary: chartRange(information.map((row) => icType === "RankIC" ? row.rankIc : row.ic)),
        secondary: chartRange(information.map((row) => icType === "RankIC" ? row.rankIcCumulative : row.icCumulative))
      },
      longShort: { primary: chartRange(longShort.map((row) => row.value), true), secondary: chartRange(longShort.map((row) => row.cumulative)) },
      groupStatistics: chartRange(groupStatistics.map((row) => row.mean), true),
      groups: chartRange(displayedGroups.flatMap((row) => Object.values(row.values))),
      turnover: chartRange(turnover?.groups.map((row) => row.value) ?? [], true),
      decay: chartRange(decay.flatMap((row) => [row.icMean, row.rankIcMean]), true)
    });
  }, [decay, displayedGroups, executionStatistics, groupStatistics, icType, information, longShort, onChartRanges, turnover]);

  if (loading) return <ResultState icon={<IconLoaderCircle className="animate-spin" width={20} height={20} />} title="DuckDB 正在读取 Parquet" detail="正在浏览器内加载因子分析结果。" />;
  if (error && !metrics) return <ResultState icon={<IconDatabase width={20} height={20} />} title="结果读取失败" detail={error} />;
  if (!metrics || !factor) return null;

  return <section className="space-y-4">
    <DateRangeBar
      endDate={endDate}
      maximumDate={maximumDate}
      minimumDate={minimumDate}
      startDate={startDate}
      theme={theme}
      points={rangePoints}
      onRangeChange={(nextStartDate, nextEndDate) => {
        setStartDate(nextStartDate);
        setEndDate(nextEndDate);
      }}
      onReset={() => { setStartDate(minimumDate); setEndDate(maximumDate); }}
    />

    <SortableCardStack
      storageKey="solo.arena.factor-analysis.overview-card-order"
      items={[
        {
          id: "execution-statistics",
          content: <ReportCard title="DSL 执行统计">
            <p className="text-xs leading-5 text-muted-foreground">区域总上沿是当日过滤前股票数；色带从上到下按实际过滤顺序展示剔除数量，底部为最终截面。比例均以原始股票数为基准。</p>
            <ChartPanel title="每日股票域与过滤去向">
              <SeriesContent loading={executionStatisticsLoading} count={executionStatistics.length} height={360}>
                {executionStatistics.length > 0 && <EChart option={executionStatisticsOption(executionStatistics, theme, chartRanges?.executionStatistics)} height={360} />}
              </SeriesContent>
            </ChartPanel>
          </ReportCard>
        },
        {
          id: "information",
          content: <ReportCard title="IC 分析">
            <CardToolbar end={<div className="flex flex-wrap items-center gap-2"><ReturnContract spec={icReturnSpec} /><Segmented value={icType} options={["RankIC", "IC"]} onChange={(value) => setIcType(value as IcType)} /></div>}>
              <ReturnSelector value={icReturnColumn} options={parameters.return_columns} onChange={setIcReturnColumn} />
            </CardToolbar>
            <MetricGrid columns={6} items={informationMetrics(information, icType)} />
            <ChartPanel title={`${icType} 时序、月度移动平均与累计`}>
              <SeriesContent loading={informationLoading} count={information.length} height={330}>{information.length >= 8 && <EChart option={informationOption(information, theme, icType, chartRanges?.information)} height={330} />}</SeriesContent>
            </ChartPanel>
          </ReportCard>
        },
        {
          id: "returns",
          content: <ReportCard title="收益分析">
            <CardToolbar end={<ReturnContract spec={returnSpec} />}><ReturnSelector value={returnColumn} options={parameters.return_columns} onChange={setReturnColumn} /></CardToolbar>
            <OverlappingReturnNotice periods={returnPeriods} />
            <MetricGrid items={returnMetrics(longShort, returnPeriods)} />
            <ChartPanel title={returnPeriods === 1 ? "多空收益与累计收益" : "多空单期收益"}>
              <SeriesContent loading={returnLoading} count={longShort.length} height={350}>{longShort.length >= 8 && <EChart option={longShortOption(longShort, theme, returnPeriods === 1, chartRanges?.longShort)} height={350} />}</SeriesContent>
            </ChartPanel>
          </ReportCard>
        },
        {
          id: "groups",
          content: <ReportCard title="分组分析">
            <CardToolbar end={<div className="flex flex-wrap items-center gap-2">
              <ReturnContract spec={groupReturnSpec} />
              <Tabs value={reverseGroups ? "reverse" : "forward"} onValueChange={(value) => setReverseGroups(value === "reverse")}>
                <TabsList aria-label="分组净值顺序">
                  <TabsTrigger disabled={groupReturnPeriods > 1} value="forward">正序</TabsTrigger>
                  <TabsTrigger disabled={groupReturnPeriods > 1} value="reverse">倒序</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>}><ReturnSelector value={groupReturnColumn} options={parameters.return_columns} onChange={setGroupReturnColumn} /></CardToolbar>
            <OverlappingReturnNotice periods={groupReturnPeriods} />
            <ChartPanel title={reverseGroups ? "各分组净值曲线（倒序累计）" : "各分组净值曲线"}>
              {groupReturnPeriods > 1
                ? <NonCompoundableChartState periods={groupReturnPeriods} height={350} />
                : <SeriesContent loading={groupLoading} count={groups.length} height={350}>{groups.length >= 8 && <EChart option={groupOption(displayedGroups, theme, chartRanges?.groups)} height={350} />}</SeriesContent>}
            </ChartPanel>
            <ChartPanel title="分组平均收益与显著性 p 值">
              <SeriesContent loading={groupLoading} count={groupStatistics.length} height={330}>{groupStatistics.length > 0 && <EChart option={groupStatisticsOption(groupStatistics, theme, chartRanges?.groupStatistics)} height={330} />}</SeriesContent>
            </ChartPanel>
          </ReportCard>
        },
        {
          id: "turnover",
          content: <ReportCard title="换手分析">
            <CardToolbar end={
              <Tabs value={turnoverPeriod === null ? "" : String(turnoverPeriod)} onValueChange={(value) => setTurnoverPeriod(Number(value))}>
                <TabsList variant="line">{turnoverPeriods.map((periods) => <TabsTrigger key={periods} value={String(periods)}>{periods} 日</TabsTrigger>)}</TabsList>
              </Tabs>
            }>
              <span className="text-xs text-muted-foreground">持有期（交易日）</span>
            </CardToolbar>
            <MetricGrid items={turnoverMetrics(turnover)} />
            <ChartPanel title="各组合平均换手率">
              <SeriesContent loading={turnoverLoading} count={turnover?.groups.filter((row) => row.value !== null).length ?? 0} height={330}>
                {turnover?.groups.some((row) => row.value !== null) && <EChart option={turnoverOption(turnover.groups, theme, chartRanges?.turnover)} height={330} />}
              </SeriesContent>
            </ChartPanel>
          </ReportCard>
        },
        {
          id: "decay",
          content: <ReportCard title="衰减分析">
            <SummaryTiles items={decaySummary(decay)} />
            <ChartPanel title="IC 均值衰减">
              <SeriesContent loading={decayLoading} count={decay.length} height={330}>{decay.length > 0 && <EChart option={decayOption(decay, theme, chartRanges?.decay)} height={330} />}</SeriesContent>
            </ChartPanel>
          </ReportCard>
        }
      ]}
    />

    {error && <div className="rounded-md border border-destructive/30 bg-destructive/8 px-4 py-3 text-xs text-destructive">{error}</div>}
  </section>;
}

function OverlappingReturnNotice({ periods }: { periods: number }) {
  if (periods <= 1) return null;
  return <div className="mx-4 mt-3 rounded-md border border-amber-500/25 bg-amber-500/8 px-3 py-2 text-xs text-muted-foreground">
    当前收益列覆盖 {periods} 个交易期，相邻观测存在重叠；保留 IC 和单期分组统计，不计算累计净值、年化收益、波动率及 Sharpe。
  </div>;
}

function ReturnContract({ spec }: { spec?: { kind: "simple" | "log"; periods: number } }) {
  if (!spec) return null;
  const compoundable = spec.periods === 1;
  return <div className="flex flex-wrap items-center gap-1 text-xs" aria-label="收益口径">
    <span className="rounded-sm bg-muted px-2 py-1 text-muted-foreground">{spec.kind === "log" ? "对数收益" : "简单收益"}</span>
    <span className="rounded-sm bg-muted px-2 py-1 text-muted-foreground">{spec.periods} 期</span>
    <span className={compoundable ? "rounded-sm bg-emerald-500/10 px-2 py-1 text-emerald-600 dark:text-emerald-400" : "rounded-sm bg-amber-500/12 px-2 py-1 text-amber-700 dark:text-amber-300"}>
      {compoundable ? "可复利" : "重叠 · 不可复利"}
    </span>
  </div>;
}

function NonCompoundableChartState({ height, periods }: { height: number; periods: number }) {
  return <div className="grid place-items-center rounded-md border border-dashed border-amber-500/25 bg-amber-500/5 px-6 text-center text-xs text-muted-foreground" style={{ height }}>
    <div><div className="text-sm text-foreground">该收益列覆盖 {periods} 期，不能连续复利</div><div className="mt-2">分组平均单期收益与显著性仍可使用；净值曲线不生成。</div></div>
  </div>;
}

function informationMetrics(rows: InformationPoint[], type: IcType): DisplayMetric[] {
  const rank = type === "RankIC";
  const values = rows.map((row) => rank ? row.rankIc : row.ic).filter((value): value is number => value !== null);
  const average = values.length ? statisticsMean(values) : null;
  const deviation = values.length > 1 ? sampleStandardDeviation(values) : null;
  const informationRatio = average !== null && deviation ? average / deviation : null;
  const pValue = values.length > 1 ? ttest(values, { alternative: "two-sided", mu: 0 }).pValue : null;
  return [
    { label: `${type} 均值`, value: format(average) },
    { label: `${type} 标准差`, value: format(deviation) },
    { label: rank ? "Rank ICIR" : "ICIR", value: format(informationRatio) },
    { label: "双侧 p 值", value: formatPValue(pValue) },
    { label: `${type} > 0 占比`, value: format(booleanMean(values, (value) => value > 0), "percent") },
    { label: `${type} > 0.03 占比`, value: format(booleanMean(values, (value) => value > 0.03), "percent") }
  ];
}

function returnMetrics(rows: LongShortPoint[], periods: number): DisplayMetric[] {
  const compoundable = periods === 1;
  const values = rows.map((row) => row.value).filter((value): value is number => value !== null);
  const cumulative = compoundable ? rows.at(-1)?.cumulative ?? null : null;
  const annualReturn = cumulative === null || !values.length || 1 + cumulative <= 0 ? null : (1 + cumulative) ** (252 / values.length) - 1;
  const annualVolatility = compoundable && values.length ? standardDeviation(values) * Math.sqrt(252) : null;
  return [
    { label: "多空累计收益", value: format(cumulative, "percent") },
    { label: "多空年化收益", value: format(annualReturn, "percent") },
    { label: "多空年化 Sharpe", value: format(annualReturn !== null && annualVolatility ? annualReturn / annualVolatility : null) },
    { label: "多空最大回撤", value: format(compoundable ? maxDrawdown(rows) : null, "percent") },
    { label: "多空年化波动", value: format(annualVolatility, "percent") },
    { label: "多空单期收益均值", value: format(values.length ? statisticsMean(values) : null, "percent") },
    { label: "多空单期收益标准差", value: format(values.length > 1 ? sampleStandardDeviation(values) : null, "percent") }
  ];
}

function decaySummary(rows: DecayPoint[]): DisplayMetric[] {
  const rankPeak = peak(rows, "rankIcMean");
  const icPeak = peak(rows, "icMean");
  return [
    { label: "Rank IC 峰值收益列", value: rankPeak?.label ?? "—" },
    { label: "Rank IC 峰值大小", value: format(rankPeak?.rankIcMean) },
    { label: "Rank IC 半衰期", value: halfLife(rows, "rankIcMean", rankPeak) },
    { label: "IC 峰值收益列", value: icPeak?.label ?? "—" },
    { label: "IC 峰值大小", value: format(icPeak?.icMean) },
    { label: "IC 半衰期", value: halfLife(rows, "icMean", icPeak) }
  ];
}

function turnoverMetrics(summary: TurnoverSummary | null): DisplayMetric[] {
  const groups = summary?.groups.filter((row): row is { group: string; value: number } => row.value !== null) ?? [];
  const average = groups.length ? statisticsMean(groups.map((row) => row.value)) : null;
  const lowest = groups.reduce<{ group: string; value: number } | null>((current, row) => !current || row.value < current.value ? row : current, null);
  const highest = groups.reduce<{ group: string; value: number } | null>((current, row) => !current || row.value > current.value ? row : current, null);
  return [
    { label: "平均组合换手率", value: format(average, "percent") },
    { label: "平均因子秩自相关", value: format(summary?.rankAutocorrelation) },
    { label: "最低换手组合", value: lowest ? `${lowest.group} · ${format(lowest.value, "percent")}` : "—" },
    { label: "最高换手组合", value: highest ? `${highest.group} · ${format(highest.value, "percent")}` : "—" }
  ];
}

function MetricGrid({ columns = 4, items }: { columns?: 4 | 6; items: DisplayMetric[] }) {
  const gridClassName = columns === 6 ? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" : "grid grid-cols-2 gap-3 md:grid-cols-4";
  return <div className={gridClassName}>{items.map((item) => <div className="rounded-md border bg-card px-4 py-3 shadow-sm" key={item.label}><div className="text-xs text-muted-foreground">{item.label}</div><div className="numeric mt-2 text-lg font-semibold tracking-tight">{item.value}</div></div>)}</div>;
}

function SummaryTiles({ items }: { items: DisplayMetric[] }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{items.map((item) => <div className="rounded-md border bg-card px-4 py-3 shadow-sm" key={item.label}><div className="text-xs text-muted-foreground">{item.label}</div><div className="numeric mt-2 truncate text-sm font-semibold">{item.value}</div></div>)}</div>;
}

function ReportCard({ children, title }: { children: React.ReactNode; title: string }) {
  return <motion.div animate={{ opacity: 1 }} initial={{ opacity: 0 }} transition={{ duration: 0.18, ease: "easeOut" }}><div className="rounded-md border bg-card py-5 shadow-sm"><h3 className="px-5 pb-2 pr-14 text-base font-semibold">{title}</h3><div className="space-y-4 px-5">{children}</div></div></motion.div>;
}

function ChartPanel({ children, title }: { children: React.ReactNode; title: string }) {
  return <motion.div animate={{ opacity: 1 }} initial={{ opacity: 0 }} transition={{ duration: 0.16, ease: "easeOut" }}><div className="rounded-md border bg-card py-4 shadow-sm"><h4 className="px-4 pb-2 text-sm font-medium">{title}</h4><div className="px-4">{children}</div></div></motion.div>;
}

function CardToolbar({ children, end }: { children: React.ReactNode; end?: React.ReactNode }) {
  return <div className="flex w-full flex-wrap items-center justify-between gap-2"><div className="min-w-0">{children}</div>{end && <div className="ml-auto shrink-0">{end}</div>}</div>;
}

function ReturnSelector({ onChange, options, value }: { onChange: (value: string) => void; options: string[]; value: string }) {
  return <div className="flex w-fit max-w-full flex-wrap gap-1 rounded-md border bg-muted/60 p-1">{options.map((option) => <Button aria-pressed={option === value} className={option === value ? "font-mono shadow-sm" : "font-mono text-muted-foreground"} key={option} size="sm" type="button" variant={option === value ? "default" : "ghost"} onClick={() => onChange(option)}>{option}</Button>)}</div>;
}

function Segmented({ onChange, options, value }: { onChange: (value: string) => void; options: string[]; value: string }) {
  return <div className="flex w-fit gap-1 rounded-md border bg-muted/60 p-1">{options.map((option) => <Button aria-pressed={option === value} className={option === value ? "shadow-sm" : "text-muted-foreground"} key={option} size="sm" type="button" variant={option === value ? "default" : "ghost"} onClick={() => onChange(option)}>{option}</Button>)}</div>;
}

function SeriesContent({ children, count, height, loading }: { children: React.ReactNode; count: number; height: number; loading: boolean }) {
  if (loading && !children) return <div className="grid place-items-center" style={{ height }}><IconLoaderCircle className="animate-spin text-primary" width={20} height={20} /></div>;
  if (!children) return <SparseState count={count} height={height} />;
  return children;
}

function SparseState({ count, height }: { count: number; height: number }) {
  return <div className="grid place-items-center rounded-md border border-dashed border-border text-center text-xs text-muted-foreground" style={{ height }}><div><div className="numeric text-2xl text-foreground">{count}</div><div className="mt-2">没有足够的数据绘制该图表</div></div></div>;
}

function ResultState({ detail, icon, title }: { detail: string; icon: React.ReactNode; title: string }) {
  return <div className="grid min-h-72 place-items-center rounded-md border bg-card p-8 text-center shadow-sm"><div><span className="mx-auto grid size-11 place-items-center rounded-full border bg-muted text-primary">{icon}</span><h3 className="mt-4 font-semibold">{title}</h3><p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{detail}</p></div></div>;
}

function informationOption(rows: InformationPoint[], theme: string, type: IcType, ranges?: DualChartRanges) {
  const values = rows.map((row) => type === "RankIC" ? row.rankIc : row.ic);
  const movingAverage = rollingMean(values, IC_MOVING_AVERAGE_WINDOW);
  const cumulative = rows.map((row) => type === "RankIC" ? row.rankIcCumulative : row.icCumulative);
  const option: Record<string, unknown> = baseOption(theme, rows.map((row) => row.time), [
    { name: type, type: "line", data: values, showSymbol: false, lineStyle: { width: 0.8, opacity: 0.7 }, color: "#4682b4" },
    { name: "1 个月移动平均（22 期）", type: "line", data: movingAverage, showSymbol: false, lineStyle: { width: 2, opacity: 0.8 }, color: "#228b22", z: 3 },
    { name: `${type} 累计`, type: "line", yAxisIndex: 1, data: cumulative, showSymbol: false, lineStyle: { width: 2.2 }, color: "#d97706" }
  ], ranges?.primary);
  option.yAxis = [axis(theme, true, ranges?.primary), axis(theme, false, ranges?.secondary)];
  return option;
}

function executionStatisticsOption(rows: ExecutionStatisticPoint[], theme: string, range?: ChartRange) {
  const filterNames = rows[0]?.filters.map((filter) => filter.name) ?? [];
  const filterSeries = filterNames.map((name, filterIndex) => ({
    name: `${name} 剔除`,
    type: "line",
    stack: "stocks",
    data: rows.map((row) => executionFilterRemovedCount(row, filterIndex)),
    showSymbol: false,
    symbol: "none",
    lineStyle: { width: 0.8, color: executionFilterColor(filterIndex) },
    areaStyle: { color: executionFilterColor(filterIndex), opacity: 0.78 },
    itemStyle: { color: executionFilterColor(filterIndex) }
  }));
  const option: Record<string, unknown> = baseOption(theme, rows.map((row) => row.time), [
    {
      name: "最终截面",
      type: "line",
      stack: "stocks",
      data: rows.map((row) => row.filteredCount),
      showSymbol: false,
      symbol: "none",
      lineStyle: { width: 1.2, color: "#2563eb" },
      areaStyle: { color: "#2563eb", opacity: 0.86 },
      itemStyle: { color: "#2563eb" }
    },
    ...[...filterSeries].reverse()
  ], range);
  const maximum = range?.max ?? Math.max(...rows.map((row) => row.sourceCount), 0);
  option.grid = { ...(option.grid as Record<string, unknown>), top: 48 };
  option.legend = {
    ...(option.legend as Record<string, unknown>),
    data: [...filterSeries.map((series) => series.name), "最终截面"],
    type: "scroll",
    right: 0
  };
  option.xAxis = { ...(option.xAxis as Record<string, unknown>), boundaryGap: false };
  option.yAxis = { ...axis(theme, true, { min: 0, max: Math.ceil(maximum * 1.04) }, "integer"), min: 0 };
  option.tooltip = {
    ...(option.tooltip as Record<string, unknown>),
    axisPointer: { type: "line" },
    formatter: (items: Array<{ dataIndex: number }>) => {
      const item = items[0];
      const row = item ? rows[item.dataIndex] : undefined;
      if (!row) return "";
      const details = row.filters.map((filter, filterIndex) => {
        const removed = executionFilterRemovedCount(row, filterIndex);
        return `${escapeHtml(filter.name)} 剔除：${removed.toLocaleString("zh-CN")}（${executionPercentage(-removed, row.sourceCount)}）`;
      });
      return [
        escapeHtml(row.time),
        `原始股票：${row.sourceCount.toLocaleString("zh-CN")}（${row.sourceCount > 0 ? "100%" : "—"}）`,
        ...details,
        `最终截面：${row.filteredCount.toLocaleString("zh-CN")}（${executionPercentage(row.filteredCount, row.sourceCount)}）`
      ].join("<br/>");
    }
  };
  return option;
}

function executionFilterColor(index: number) {
  const colors = ["#94a3b8", "#f59e0b", "#f97316", "#ef4444", "#a855f7", "#14b8a6", "#64748b", "#e11d48"];
  return colors[index % colors.length];
}

function escapeHtml(value: string) {
  const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
  return value.replace(/[&<>"']/g, (character) => entities[character] ?? character);
}

function rollingMean(values: Array<number | null>, window: number) {
  return values.map((_, index) => {
    if (index < window - 1) return null;
    const sample = values.slice(index - window + 1, index + 1);
    if (sample.some((value) => value === null || !Number.isFinite(value))) return null;
    return statisticsMean(sample as number[]);
  });
}

function longShortOption(rows: LongShortPoint[], theme: string, compoundable: boolean, ranges?: DualChartRanges) {
  const series = [
    { name: "多空收益", type: "bar", data: rows.map((row) => row.value), itemStyle: { color: "#2563eb", opacity: 0.55 } },
    ...compoundable ? [{ name: "累计收益", type: "line", yAxisIndex: 1, data: rows.map((row) => row.cumulative), showSymbol: false, lineStyle: { width: 2.2 }, color: "#d97706" }] : []
  ];
  const option: Record<string, unknown> = baseOption(theme, rows.map((row) => row.time), series, ranges?.primary);
  option.yAxis = compoundable
    ? [axis(theme, true, ranges?.primary, "percent"), axis(theme, false, ranges?.secondary, "percent")]
    : axis(theme, true, ranges?.primary, "percent");
  return option;
}

function groupStatisticsOption(rows: GroupStatistic[], theme: string, range?: ChartRange) {
  const option: Record<string, unknown> = baseOption(theme, rows.map((row) => row.group), [
    { name: "平均收益", type: "bar", data: rows.map((row) => row.mean), itemStyle: { color: "#2563eb", opacity: 0.72 }, barMaxWidth: 34 },
    { name: "p 值", type: "line", yAxisIndex: 1, data: rows.map((row) => row.pValue), symbolSize: 7, lineStyle: { width: 1.8 }, color: "#d97706", markLine: thresholdMarkLine(theme, "p = 0.05", 0.05) }
  ], range);
  option.xAxis = { ...(option.xAxis as Record<string, unknown>), boundaryGap: true };
  option.yAxis = [axis(theme, true, range, "percent"), { ...axis(theme, false), min: 0, max: 1 }];
  return option;
}

function groupChartPoints(rows: GroupPoint[], reverse: boolean): GroupPoint[] {
  if (!reverse || !rows.length) return rows;
  const latest = rows[rows.length - 1];
  // A separate anchor keeps the latest day's return instead of discarding it.
  const anchor = { ...latest, time: `${latest.time}（起点）`, values: Object.fromEntries(Object.keys(latest.values).map((name) => [name, 1])) };
  return [anchor, ...rows.slice().reverse().map((row) => ({ ...row, values: row.reverseValues }))];
}

function groupOption(rows: GroupPoint[], theme: string, range?: ChartRange) {
  const names = Object.keys(rows[0]?.values ?? {});
  return baseOption(theme, rows.map((row) => row.time), names.map((name, index) => ({
    name,
    type: "line",
    data: rows.map((row) => row.values[name]),
    showSymbol: false,
    lineStyle: { width: index === 0 || index === names.length - 1 ? 2.2 : 1.2 },
    color: groupColor(index, names.length)
  })), range);
}

function groupColor(index: number, count: number) {
  const start = [219, 234, 254];
  const end = [30, 58, 138];
  const ratio = count <= 1 ? 1 : index / (count - 1);
  return `#${start.map((channel, channelIndex) => Math.round(
    channel + (end[channelIndex] - channel) * ratio
  ).toString(16).padStart(2, "0")).join("")}`;
}

function decayOption(rows: DecayPoint[], theme: string, range?: ChartRange) {
  const option: Record<string, unknown> = baseOption(theme, rows.map((row) => row.label), [
    { name: "IC 均值", type: "bar", data: rows.map((row) => row.icMean), itemStyle: { color: "#2563eb", opacity: 0.78 }, barMaxWidth: 24 },
    { name: "RankIC 均值", type: "bar", data: rows.map((row) => row.rankIcMean), itemStyle: { color: "#059669", opacity: 0.78 }, barMaxWidth: 24 }
  ], range);
  option.xAxis = { ...(option.xAxis as Record<string, unknown>), boundaryGap: true };
  return option;
}

function turnoverOption(rows: TurnoverSummary["groups"], theme: string, range?: ChartRange) {
  const option: Record<string, unknown> = baseOption(theme, rows.map((row) => row.group), [{
    name: "平均换手率",
    type: "bar",
    data: rows.map((row) => row.value),
    barMaxWidth: 46,
    itemStyle: { color: (params: { dataIndex: number }) => groupColor(params.dataIndex, rows.length), borderRadius: [4, 4, 0, 0] },
    label: { show: true, position: "top", formatter: (params: { value: number }) => `${(params.value * 100).toFixed(1)}%`, color: theme === "dark" ? "#cbd5e1" : "#475569", fontSize: 10 }
  }], range);
  option.xAxis = { ...(option.xAxis as Record<string, unknown>), boundaryGap: true };
  option.yAxis = { ...axis(theme, true, range, "percent"), min: 0, max: 1 };
  option.tooltip = { ...(option.tooltip as Record<string, unknown>), valueFormatter: (value: number) => `${(value * 100).toFixed(2)}%` };
  return option;
}

function baseOption(theme: string, x: string[], series: unknown[], range?: ChartRange) {
  const color = theme === "dark" ? "#8996a5" : "#687771";
  const line = theme === "dark" ? "rgba(160,184,210,.10)" : "rgba(24,66,54,.10)";
  return {
    animationDuration: 450,
    grid: { left: 50, right: 34, top: 42, bottom: 38, containLabel: true },
    legend: { top: 0, left: 0, textStyle: { color, fontSize: 10 } },
    tooltip: { trigger: "axis", backgroundColor: theme === "dark" ? "#151b24" : "#fff", borderColor: line, textStyle: { color: theme === "dark" ? "#eef4f7" : "#13201d", fontSize: 11 } },
    xAxis: { type: "category", data: x, boundaryGap: false, axisLine: { lineStyle: { color: line } }, axisLabel: { color, fontSize: 9, hideOverlap: true }, axisTick: { show: false } },
    yAxis: axis(theme, true, range),
    series
  };
}

function axis(theme: string, splitLine = true, range?: ChartRange, format: AxisFormat = "decimal") {
  const color = theme === "dark" ? "#8996a5" : "#687771";
  const line = theme === "dark" ? "rgba(160,184,210,.10)" : "rgba(24,66,54,.10)";
  return { type: "value", scale: true, min: range?.min, max: range?.max, axisLabel: { color, fontSize: 9, formatter: (value: number) => formatAxisLabel(value, format) }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: splitLine, lineStyle: { color: line } } };
}

function peak(rows: DecayPoint[], field: "icMean" | "rankIcMean") {
  return rows.reduce<DecayPoint | null>((current, row) => {
    const value = row[field];
    if (value === null) return current;
    return !current || Math.abs(value) > Math.abs(current[field] ?? 0) ? row : current;
  }, null);
}

function halfLife(rows: DecayPoint[], field: "icMean" | "rankIcMean", peakRow: DecayPoint | null) {
  if (!peakRow || Math.abs(peakRow[field] ?? 0) <= 0) return "—";
  const threshold = Math.abs(peakRow[field] ?? 0) / 2;
  const found = rows.find((row) => row.position > peakRow.position && Math.abs(row[field] ?? Number.POSITIVE_INFINITY) <= threshold);
  return found?.label ?? "未触及";
}

function maxDrawdown(rows: LongShortPoint[]) {
  let peakValue = 1;
  let maximum = 0;
  for (const row of rows) {
    const value = 1 + (row.cumulative ?? 0);
    peakValue = Math.max(peakValue, value);
    maximum = Math.max(maximum, peakValue > 0 ? 1 - value / peakValue : 0);
  }
  return rows.length ? maximum : null;
}

function booleanMean(values: number[], predicate: (value: number) => boolean) {
  return values.length ? statisticsMean(values.map((value) => predicate(value) ? 1 : 0)) : null;
}

function formatPValue(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return value < 0.0001 ? "< 0.0001" : value.toFixed(4);
}

function format(value: number | null | undefined, type: "number" | "percent" = "number") {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return type === "percent" ? `${(value * 100).toFixed(2)}%` : value.toFixed(4);
}

function returnPeriodsOf(parameters: FactorReportParameters, returnColumn: string) {
  return parameters.return_specs[returnColumn].periods;
}

function executionFilterRemovedCount(row: ExecutionStatisticPoint, filterIndex: number) {
  const previous = filterIndex === 0
    ? row.sourceCount
    : row.filters[filterIndex - 1]?.count ?? row.filteredCount;
  const remaining = row.filters[filterIndex]?.count ?? row.filteredCount;
  return Math.max(0, previous - remaining);
}

function executionPercentage(value: number, sourceCount: number) {
  if (sourceCount <= 0) return "—";
  return executionPercentageFormatter.format(value / sourceCount);
}
