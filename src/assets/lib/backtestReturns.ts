import type { PortfolioPoint } from "@/assets/lib/backtestAnalysis";
import { quantStatsReport, type QuantStatsReport } from "@/assets/lib/quantstats";

export type BacktestReturnMode = "strategy" | "excess";

export function excessReturnError(rows: PortfolioPoint[]): string {
  if (!rows.length) return "";
  if (rows.length < 2) return "超额收益至少需要两个交易日；区间首日仅作为净值基点。";
  if (rows.some((row) => !positiveNetValue(row.benchmarkNetValue))) return "所选区间缺少完整、有效的基准净值，无法计算超额收益。请调整日期范围或切回策略收益。";
  if (rows.some((row) => !positiveNetValue(row.netValue))) return "所选区间包含无效或非正的策略净值，无法计算超额收益。";
  return "";
}

export function backtestReturnPoints(rows: PortfolioPoint[], mode: BacktestReturnMode) {
  return rows.map((row, index) => {
    if (mode === "strategy") return { time: row.time, value: row.dailyReturn };
    const previous = rows[index - 1];
    if (!positiveNetValue(row.netValue) || !positiveNetValue(row.benchmarkNetValue)) return { time: row.time, value: null };
    if (!previous) return { time: row.time, value: 0 };
    if (!positiveNetValue(previous.netValue) || !positiveNetValue(previous.benchmarkNetValue)) return { time: row.time, value: null };
    const value = row.netValue / previous.netValue / (row.benchmarkNetValue / previous.benchmarkNetValue) - 1;
    return { time: row.time, value: Number.isFinite(value) ? value : null };
  });
}

export function createBacktestReport(rows: PortfolioPoint[], periods: number, riskFreeRate: number, excludeInitialReturn: boolean, mode: BacktestReturnMode): QuantStatsReport | null {
  if (!rows.length) return null;
  if (mode === "strategy") return quantStatsReport(rows.map((row) => ({ time: row.time, value: row.dailyReturn ?? 0 })), periods, riskFreeRate, excludeInitialReturn);
  if (excessReturnError(rows)) return null;
  const returns = backtestReturnPoints(rows, mode).slice(1);
  if (returns.some((row) => row.value === null)) return null;
  const report = quantStatsReport(returns.map((row) => ({ time: row.time, value: row.value! })), periods, 0);
  // The first observation is the common NAV baseline, not a measured return interval.
  return {
    ...report,
    netValue: [{ time: rows[0].time, value: 1 }, ...report.netValue],
    drawdown: [{ time: rows[0].time, value: 0 }, ...report.drawdown]
  };
}

export function benchmarkValues(rows: PortfolioPoint[]) {
  const base = rows.find((row) => positiveNetValue(row.benchmarkNetValue))?.benchmarkNetValue;
  return rows.map((row) => base && positiveNetValue(row.benchmarkNetValue) ? row.benchmarkNetValue / base : null);
}

function positiveNetValue(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}
