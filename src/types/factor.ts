export type FactorReturnSpec = { kind: "simple" | "log"; periods: number };

export type FactorReportParameters = {
  factor_columns: string[];
  return_columns: string[];
  return_specs: Record<string, FactorReturnSpec>;
  n_groups: number;
  n_select: number;
};

export type FactorMetricSummary = {
  return_kind?: "simple" | "log" | null;
  return_periods?: number | null;
  compoundable?: boolean | null;
  observations: number;
  ic_mean: number | null;
  ic_std: number | null;
  ic_ir: number | null;
  ic_positive_ratio: number | null;
  rank_ic_mean: number | null;
  rank_ic_std: number | null;
  rank_ic_ir: number | null;
  rank_ic_positive_ratio: number | null;
  long_short_cumulative_return: number | null;
  long_short_annual_return: number | null;
  long_short_annual_volatility: number | null;
  long_short_sharpe: number | null;
  long_short_max_drawdown: number | null;
  average_turnover?: number | null;
};

export type FactorMetrics = Record<string, Record<string, FactorMetricSummary>>;
