import type { FactorPriceColumn, FactorReportParameters, FactorReturnSpec } from "@/types/factor";

type ReturnParameters = Pick<FactorReportParameters, "return_columns" | "return_specs">;
const priceColumns: readonly FactorPriceColumn[] = ["open", "close", "open_hfq", "close_hfq"];

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function priceColumn(value: unknown): value is FactorPriceColumn {
  return priceColumns.includes(value as FactorPriceColumn);
}

/** 同一价格列在 t+k 入场、t+k+period 出场；lag 不代表收益跨度。 */
export function priceReturns(period: unknown, price: unknown, maxLag: unknown, kind: FactorReturnSpec["kind"] = "log"): ReturnParameters {
  if (!positiveInteger(period)) throw new Error("报告 period 必须为正整数");
  if (!priceColumn(price)) throw new Error("报告 price_column 仅支持 open、close、open_hfq、close_hfq");
  if (!positiveInteger(maxLag)) throw new Error("报告 max_lag 必须为正整数");
  if (kind !== "simple" && kind !== "log") throw new Error("报告收益类型无效");
  const entries = Array.from({ length: maxLag }, (_, index): [string, FactorReturnSpec] => [
    `P${period}L${index + 1}`,
    { kind, periods: period, lag: index + 1, price_column: price, turnover_period: period }
  ]);
  return { return_columns: entries.map(([column]) => column), return_specs: Object.fromEntries(entries) };
}

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

/** 仅显式 metadata 决定收益口径；新的价格规格不依赖列名猜测持有期。 */
export function returnMetadata(column: string, spec: Record<string, unknown>): Pick<FactorReturnSpec, "lag" | "price_column" | "session" | "turnover_period"> {
  const { lag, session, turnover_period: turnoverPeriod } = spec;
  if (Object.hasOwn(spec, "price_column")) {
    if ((spec.kind !== "simple" && spec.kind !== "log") || !positiveInteger(spec.periods) || !positiveInteger(lag)
      || !priceColumn(spec.price_column) || Object.hasOwn(spec, "session")
      || turnoverPeriod !== undefined && !positiveInteger(turnoverPeriod)) {
      throw new Error("报告价格收益规格无效：需要 simple 或 log、正整数 periods / lag 和合法 price_column");
    }
    return { lag, price_column: spec.price_column, ...(turnoverPeriod !== undefined ? { turnover_period: turnoverPeriod as number } : {}) };
  }
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
