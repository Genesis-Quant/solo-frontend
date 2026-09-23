export type ChartRange = { min: number; max: number };
export type AxisFormat = "decimal" | "integer" | "percent";

export type FactorChartRanges = {
  executionStatistics?: ChartRange;
  information?: { primary?: ChartRange; secondary?: ChartRange };
  longShort?: { primary?: ChartRange; secondary?: ChartRange };
  groupStatistics?: ChartRange;
  groups?: ChartRange;
  turnover?: ChartRange;
  decay?: ChartRange;
};

export type BacktestChartRanges = {
  netValue?: ChartRange;
  totalEquity?: ChartRange;
  drawdown?: ChartRange;
  rollingSharpe?: ChartRange;
};
