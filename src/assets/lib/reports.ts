import { createContext, useContext } from "react";
import type { ProjectKind, ResearchVersion } from "@/types/research";
import type { FactorReportParameters } from "@/types/factor";
import { apiUrl } from "./settings";
import { schemeMajor } from "./scheme";
import { factorFixtureParameters, reportFixtureUrl, reportOutputs } from "./reportFixture";

export interface ReportData {
  schemeVersion: string;
  kind: "factor" | "backtest";
  files: Record<string, string>;
  parameters?: FactorReportParameters;
  annualTradingDays: number;
  riskFreeRate: number;
}

export interface ReportApi {
  outputs: () => Promise<{ name: string }[]>;
  output: (workflowId: number, name: string) => Promise<ArrayBuffer>;
}

export const ReportContext = createContext<ReportApi | null>(null);
export function useReportApi(): ReportApi {
  const api = useContext(ReportContext);
  if (!api) throw new Error("缺少报告数据源");
  return api;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("报告清单格式无效");
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) throw new Error("报告参数无效");
  return value;
}

function readV1(input: Record<string, unknown>, files: Record<string, string>, schemeVersion: string): ReportData {
  if (input.kind !== "factor" && input.kind !== "backtest") throw new Error("未知报告类型");
  const kind = input.kind;
  for (const name of kind === "factor" ? ["information_coefficient", "group_returns"] : ["daily_portfolios", "trade_details", "daily_positions", "daily_trading_statistics"]) {
    if (!files[name]) throw new Error(`报告缺少 ${name}`);
  }
  const data: ReportData = { schemeVersion, kind, files, annualTradingDays: 252, riskFreeRate: 0 };
  if (kind === "factor") {
    const analysis = object(input.analysis);
    if (!Array.isArray(analysis.columns) || !analysis.columns.length || !analysis.columns.every((s) => typeof s === "string" && s)) throw new Error("报告缺少因子列");
    if (!Array.isArray(analysis.return_periods) || !analysis.return_periods.length) throw new Error("报告缺少收益持有期");
    const periods = analysis.return_periods.map(positiveInteger);
    data.parameters = {
      factor_columns: analysis.columns,
      return_columns: periods.map((period) => `return_${period}`),
      return_specs: Object.fromEntries(periods.map((period) => [`return_${period}`, { kind: "simple", periods: period }])),
      n_groups: positiveInteger(analysis.groups),
      n_select: positiveInteger(analysis.n_select)
    };
  }
  return data;
}

const adapters: Record<number, typeof readV1> = { 1: readV1 };

export function parseReport(manifest: unknown, outputUrl: string, projectKind: ProjectKind): ReportData {
  const run = object(manifest);
  if (run.protocol !== 1 || run.status !== "success") throw new Error("报告尚未完成或清单协议不受支持");
  const version = object(run.versions).scheme;
  const major = typeof version === "string" ? schemeMajor(version) : null;
  const adapter = major === null ? undefined : adapters[major];
  if (!adapter) throw new Error(`尚不支持 Scheme ${String(version ?? "未记录")} 的报告`);
  const input = object(run.input);
  if (input.kind !== (projectKind === "factor" ? "factor" : "backtest")) throw new Error("报告类型与项目不一致");
  const files = Object.fromEntries(Object.entries(object(run.reports)).map(([name, file]) => {
    if (typeof file !== "string" || !/^[\w.-]+\.parquet$/.test(file)) throw new Error("报告文件名无效");
    return [name, `${outputUrl}/${encodeURIComponent(file)}`];
  }));
  return adapter(input, files, version as string);
}

export async function loadReport(version: ResearchVersion, kind: ProjectKind, signal?: AbortSignal): Promise<ReportData> {
  if (version.reportPath) {
    const path = version.reportPath.split("/");
    if (path.some((part) => !part || part === "." || part === ".." || part.includes("\\"))) throw new Error("报告路径无效");
    const url = `${apiUrl}/reports/${path.map(encodeURIComponent).join("/")}`;
    const response = await fetch(`${url}/run.json`, { signal });
    if (!response.ok) throw new Error(`报告清单读取失败 (${response.status})`);
    return parseReport(await response.json(), url, kind);
  }
  if (!version.reportFixture) throw new Error("该次运行尚未关联报告目录");
  // 占位数据明确属于 Scheme 1，不能借用项目当前版本解释历史报告。
  const reportKind = kind === "factor" ? "factor" : "backtest";
  return {
    schemeVersion: "1.0.0", kind: reportKind,
    files: Object.fromEntries(reportOutputs[reportKind].map((name) => [name, reportFixtureUrl(reportKind, name)])),
    parameters: reportKind === "factor" ? factorFixtureParameters : undefined,
    annualTradingDays: 252, riskFreeRate: 0
  };
}

export function reportApi(report: ReportData): ReportApi {
  return {
    outputs: async () => Object.keys(report.files).map((name) => ({ name })),
    output: async (_workflowId, name) => {
      const url = report.files[name];
      if (!url) throw new Error(`报告缺少 ${name}`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`报告读取失败：${name} (${response.status})`);
      return response.arrayBuffer();
    }
  };
}
