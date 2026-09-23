import type { BacktestTableName } from "@/assets/lib/backtestAnalysis";
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

async function readFixture(kind: keyof typeof reportOutputs, name: string): Promise<ArrayBuffer> {
  const response = await fetch(reportFixtureUrl(kind, name));
  if (!response.ok) throw new Error(`示例报告加载失败：${name} (${response.status})`);
  return response.arrayBuffer();
}

// Match Arena's report data interface; every prototype version uses the same fixed files.
export const factorApi = {
  outputs: async () => factorOutputs.map((name) => ({ name })),
  output: (_workflowInstanceId: number, name: typeof factorOutputs[number]) => readFixture("factor", name)
};

export const backtestApi = {
  output: (_workflowInstanceId: number, name: BacktestTableName) => readFixture("backtest", name)
};
