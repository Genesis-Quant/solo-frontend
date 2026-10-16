import type { FactorReportParameters, FactorReturnSpec } from "@/types/factor";

/** lag 表示标签位置；每列均为单段收益，不能用 lag 代替 periods。 */
export function laggedReturns(maxLag: unknown): Pick<FactorReportParameters, "return_columns" | "return_specs"> {
  if (typeof maxLag !== "number" || !Number.isSafeInteger(maxLag) || maxLag < 1) throw new Error("报告 max_lag 必须为正整数");
  const entries: Array<[string, FactorReturnSpec]> = [];
  for (let k = 1; k <= maxLag; k++) {
    entries.push(
      [`r${k - 1}o`, { kind: "simple", periods: 1, lag: k - 1, session: "overnight", turnover_period: k }],
      [`r${k}`, { kind: "simple", periods: 1, lag: k, session: "intraday", turnover_period: k }]
    );
  }
  return { return_columns: entries.map(([column]) => column), return_specs: Object.fromEntries(entries) };
}

/** metadata 可省略；已提供的时段信息仍需遵循单段收益口径。 */
export function returnMetadata(column: string, spec: Record<string, unknown>): Pick<FactorReturnSpec, "lag" | "session" | "turnover_period"> {
  const { lag, session, turnover_period: turnoverPeriod } = spec;
  if ((lag !== undefined || session !== undefined) && (spec.kind !== "simple" || spec.periods !== 1)
    || lag !== undefined && (typeof lag !== "number" || !Number.isSafeInteger(lag) || lag < 0)
    || session !== undefined && session !== "overnight" && session !== "intraday"
    || turnoverPeriod !== undefined && (typeof turnoverPeriod !== "number" || !Number.isSafeInteger(turnoverPeriod) || turnoverPeriod < 1)
    || typeof lag === "number" && session !== undefined && ((session === "intraday" && lag < 1)
      || column !== `r${lag}${session === "overnight" ? "o" : ""}`)) {
    throw new Error("报告收益时段规格与标签不一致");
  }
  return {
    ...(lag !== undefined ? { lag: lag as number } : {}),
    ...(session !== undefined ? { session: session as FactorReturnSpec["session"] } : {}),
    ...(turnoverPeriod !== undefined ? { turnover_period: turnoverPeriod as number } : {})
  };
}
