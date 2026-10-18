export type FactorPriceColumn = "open" | "close" | "open_hfq" | "close_hfq";

export type FactorReturnSpec = {
  kind: "simple" | "log";
  periods: number;
  lag?: number;
  price_column?: FactorPriceColumn;
  /** 仅历史隔夜 / 日内报告使用；不得用于新的同价收益规格。 */
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
