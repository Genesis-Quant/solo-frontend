import type { FactorReportParameters } from "@/types/factor";

export const factorFixtureParameters: FactorReportParameters = {
  factor_columns: ["momentum_20d"],
  return_columns: ["return_1d", "return_5d", "return_20d"],
  return_specs: {
    return_1d: { kind: "simple", periods: 1 },
    return_5d: { kind: "simple", periods: 5 },
    return_20d: { kind: "simple", periods: 20 }
  },
  n_groups: 5,
  n_select: 10
};

const factorOutputs = ["information_coefficient", "group_returns", "group_turnover", "execution_statistics"] as const;
export const reportOutputs = {
  factor: factorOutputs,
  backtest: ["daily_portfolios", "trade_details", "daily_positions", "daily_trading_statistics"] as const
};

export function reportFixtureUrl(kind: keyof typeof reportOutputs, name: string): string {
  return `${import.meta.env.BASE_URL}reports/${kind}/${name}.parquet`;
}
