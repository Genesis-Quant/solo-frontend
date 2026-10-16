export type FactorReturnSpec = {
  kind: "simple" | "log";
  periods: number;
  lag?: number;
  session?: "overnight" | "intraday";
  turnover_period?: number;
};

export type FactorReportParameters = {
  factor_columns: string[];
  return_columns: string[];
  return_specs: Record<string, FactorReturnSpec>;
  n_groups: number;
  n_select: number;
};
