import { createContext, useContext } from "react";
import type { ProjectKind, ResearchVersion } from "@/types/research";
import type { FactorReportParameters } from "@/types/factor";
import { apiUrl } from "./settings";
import { schemeMajor, supportsScheme } from "./scheme";
import { laggedReturns, priceReturns } from "./factorReturns";

export type ReportProjectKind = ProjectKind | "strategy";

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

function readV1(input: Record<string, unknown>, files: Record<string, string>, schemeVersion: string, reportKind: unknown): ReportData {
  if (reportKind !== "factor" && reportKind !== "backtest") throw new Error("未知报告类型");
  const kind = reportKind;
  for (const name of kind === "factor" ? ["information_coefficient", "group_returns"] : []) {
    if (!files[name]) throw new Error(`报告缺少 ${name}`);
  }
  const data: ReportData = { schemeVersion, kind, files, annualTradingDays: 252, riskFreeRate: 0 };
  if (kind === "factor") {
    const analysis = object(input.analysis);
    if (!Array.isArray(analysis.columns) || !analysis.columns.length || !analysis.columns.every((s) => typeof s === "string" && s)) throw new Error("报告缺少因子列");
    const hasMaxLag = Object.hasOwn(analysis, "max_lag");
    const hasPriceReturns = Object.hasOwn(analysis, "period") || Object.hasOwn(analysis, "price_column");
    if ((hasMaxLag || hasPriceReturns) && Object.hasOwn(analysis, "return_periods")) throw new Error("报告 max_lag / period / price_column 与 return_periods 不能同时提供");
    let returns: Pick<FactorReportParameters, "return_columns" | "return_specs">;
    if (hasPriceReturns) {
      // 任一新字段出现就校验完整新契约；收益口径由 run.json 的实际 Scheme 版本决定。
      const returnKind = schemeMajor(schemeVersion) === 1 && Number(schemeVersion.split(".")[1] ?? 0) >= 10 ? "log" : "simple";
      returns = priceReturns(analysis.period, analysis.price_column, analysis.max_lag, returnKind);
    } else if (hasMaxLag) {
      returns = laggedReturns(analysis.max_lag);
    } else {
      // 旧清单仍表示多日收盘到收盘收益，不转换为新的隔夜 / 日内标签。
      if (!Array.isArray(analysis.return_periods) || !analysis.return_periods.length) throw new Error("报告缺少收益持有期");
      const periods = analysis.return_periods.map(positiveInteger);
      returns = {
        return_columns: periods.map((period) => `return_${period}`),
        return_specs: Object.fromEntries(periods.map((period) => [`return_${period}`, { kind: "simple", periods: period }]))
      };
    }
    data.parameters = {
      factor_columns: analysis.columns,
      ...returns,
      n_groups: positiveInteger(analysis.groups),
      n_select: positiveInteger(analysis.n_select)
    };
  }
  return data;
}

const adapters: Record<number, typeof readV1> = { 1: readV1 };

export function parseReport(manifest: unknown, outputUrl: string, projectKind: ReportProjectKind): ReportData {
  const run = object(manifest);
  if (run.protocol !== 1 || run.status !== "success") throw new Error("报告尚未完成或清单协议不受支持");
  const version = object(run.versions).scheme;
  const major = typeof version === "string" ? schemeMajor(version) : null;
  const adapter = major === null ? undefined : adapters[major];
  if (!adapter) throw new Error(`尚不支持 Scheme ${String(version ?? "未记录")} 的报告`);
  const input = object(run.input);
  if (input.kind !== projectKind) throw new Error("报告任务类型与项目不一致");
  const files = Object.fromEntries(Object.entries(object(run.reports)).map(([name, file]) => {
    if (typeof file !== "string" || !file || file === "." || file === ".." || /[\\/:\u0000-\u001f\u007f-\u009f]/.test(file)) throw new Error("报告文件名无效");
    return [name, `${outputUrl}/${encodeURIComponent(file)}`];
  }));
  return adapter(input, files, version as string, run.report_kind);
}

export async function loadReport(version: ResearchVersion, kind: ProjectKind, signal?: AbortSignal): Promise<ReportData> {
  if (!version.reportPath) throw new Error("该次运行尚未关联报告目录");
  return loadReportPath(version.reportPath, kind, undefined, signal);
}

/** path 为共享 runs 下的报告目录；Scheme 主版本决定报告解析方式。 */
export async function loadReportPath(path: string, kind: ReportProjectKind, schemeVersion?: string, signal?: AbortSignal): Promise<ReportData> {
  if (schemeVersion !== undefined && !supportsScheme(schemeVersion)) throw new Error(`尚不支持 Scheme ${schemeVersion} 的报告`);
  const parts = path.replace(/^\/shared\/runs\//, "").split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[\\:\u0000]/.test(part))) throw new Error("报告路径无效");
  const url = `${apiUrl}/reports/${parts.map(encodeURIComponent).join("/")}`;
  const response = await fetch(`${url}/run.json`, { signal });
  if (!response.ok) throw new Error(`报告清单读取失败 (${response.status})`);
  const report = parseReport(await response.json(), url, kind);
  if (schemeVersion !== undefined && schemeMajor(report.schemeVersion) !== schemeMajor(schemeVersion)) {
    throw new Error(`报告使用 Scheme ${report.schemeVersion}，与请求的 Scheme ${schemeVersion} 主版本不一致`);
  }
  return report;
}

export function reportApi(report: ReportData): ReportApi {
  return {
    outputs: async () => Object.keys(report.files).map((name) => ({ name })),
    output: async (_workflowId, name) => {
      const url = report.files[name];
      if (!url) throw new Error(`报告缺少 ${name}`);
      if (url.startsWith("/jupyter/")) {
        const { fetchNotebookFile, readNotebookParquet } = await import("./notebookReports");
        const response = await fetchNotebookFile(url);
        if (!response.ok) throw new Error(`报告读取失败：${name} (${response.status})`);
        return readNotebookParquet(response);
      }
      const response = await fetch(url);
      if (!response.ok) throw new Error(`报告读取失败：${name} (${response.status})`);
      return response.arrayBuffer();
    }
  };
}
