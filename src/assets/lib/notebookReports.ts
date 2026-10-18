import type { FactorReportParameters } from "@/types/factor";
import type { ReportData } from "./reports";
import { schemeMajor } from "./scheme";
import { returnMetadata } from "./factorReturns";

export interface NotebookReportData extends ReportData {
  theme: "light" | "dark";
}

const loginMessage = "请先在同一浏览器中登录 Jupyter，再重新加载报告；若已登录，请检查同源 /jupyter 代理及文件访问权限。";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("报告清单格式无效");
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error("报告参数必须为正整数");
  return value;
}

function columns(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || !value.every((column) => typeof column === "string" && column.trim() && !column.includes("\u0000")) || new Set(value).size !== value.length) {
    throw new Error("报告因子列或收益列无效");
  }
  return value as string[];
}

function factorParameters(value: unknown): FactorReportParameters {
  const parameters = object(value);
  const factorColumns = columns(parameters.factor_columns);
  const returnColumns = columns(parameters.return_columns);
  const specs = object(parameters.return_specs);
  const returnSpecs = Object.fromEntries(returnColumns.map((column) => {
    if (!Object.hasOwn(specs, column)) throw new Error("报告缺少收益规格");
    const spec = object(specs[column]);
    if (spec.kind !== "simple" && spec.kind !== "log") throw new Error("报告收益类型无效");
    return [column, { kind: spec.kind, periods: positiveInteger(spec.periods), ...returnMetadata(column, spec) }];
  })) as FactorReportParameters["return_specs"];
  return {
    factor_columns: factorColumns,
    return_columns: returnColumns,
    return_specs: returnSpecs,
    n_groups: positiveInteger(parameters.n_groups),
    n_select: positiveInteger(parameters.n_select)
  };
}

/** 清单路径相对于 Jupyter root；不接受 URL、绝对路径或路径穿越。 */
export function notebookReportUrl(path: string): string {
  if (typeof path !== "string") throw new Error("报告路径无效");
  const parts = path.split("/");
  if (parts.some((part) => !part.trim() || part === "." || part === ".." || /[\\:\u0000]/.test(part))) throw new Error("报告路径无效");
  if (parts.at(-1) !== "report.json") throw new Error("请提供 report.json 清单路径");
  return `/jupyter/solo/files/${parts.map(encodeURIComponent).join("/")}`;
}

/** Notebook 清单独立于任务 run.json，回测文件由所选页面按需读取。 */
export function parseNotebookReport(manifest: unknown, path: string): NotebookReportData {
  const manifestUrl = notebookReportUrl(path);
  const data = object(manifest);
  if (data.protocol !== 1 || data.format !== "solo-notebook-report") throw new Error("Notebook 报告清单协议不受支持");
  if (typeof data.schemeVersion !== "string" || schemeMajor(data.schemeVersion) !== 1) {
    throw new Error(`尚不支持 Scheme ${String(data.schemeVersion ?? "未记录")} 的报告`);
  }
  if (data.kind !== "factor" && data.kind !== "backtest") throw new Error("未知报告类型");
  const theme = data.theme ?? "light";
  if (theme !== "light" && theme !== "dark") throw new Error("报告 theme 仅支持 light 或 dark");
  const annualTradingDays = data.kind === "backtest" ? positiveInteger(data.annualTradingDays ?? 252) : 252;
  const riskFreeRate = data.kind === "backtest" ? data.riskFreeRate ?? 0 : 0;
  if (data.kind === "backtest" && (typeof riskFreeRate !== "number" || !Number.isFinite(riskFreeRate))) throw new Error("报告 riskFreeRate 必须为有限数值");
  const base = manifestUrl.slice(0, manifestUrl.lastIndexOf("/"));
  const files = Object.fromEntries(Object.entries(object(data.files)).map(([name, file]) => {
    if (typeof file !== "string" || !file || file === "." || file === ".." || /[\\/:\u0000-\u001f\u007f-\u009f]/.test(file)) throw new Error("报告文件名无效");
    return [name, `${base}/${encodeURIComponent(file)}`];
  }));
  for (const name of data.kind === "factor" ? ["information_coefficient", "group_returns"] : []) {
    if (!Object.hasOwn(files, name)) throw new Error(`报告缺少 ${name}`);
  }
  const report: NotebookReportData = {
    schemeVersion: data.schemeVersion,
    kind: data.kind,
    theme,
    files,
    annualTradingDays,
    riskFreeRate: riskFreeRate as number
  };
  if (data.kind === "factor") report.parameters = factorParameters(data.parameters);
  else if (Object.hasOwn(data, "parameters")) throw new Error("报告 parameters 仅适用于 factor");
  return report;
}

function xsrfCookie(): string | undefined {
  const match = typeof document === "undefined" ? null : /(?:^|;\s*)_xsrf=([^;]*)/.exec(document.cookie);
  if (!match) return undefined;
  try {
    const value = decodeURIComponent(match[1]);
    return value && !/[\u0000-\u001f\u007f]/.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** 仅同源 /jupyter/ 请求读取 XSRF Cookie；不携带 token 或跟随登录重定向。 */
export async function fetchNotebookFile(url: string, signal?: AbortSignal): Promise<Response> {
  if (!url.startsWith("/jupyter/")) throw new Error("Jupyter 报告必须通过同源 /jupyter/ 读取");
  const xsrf = xsrfCookie();
  const response = await fetch(url, {
    signal,
    credentials: "same-origin",
    redirect: "manual",
    ...(xsrf ? { headers: { "X-XSRFToken": xsrf } } : {})
  });
  if (response.type === "opaqueredirect" || response.redirected || (response.status >= 300 && response.status < 400)
    || response.status === 401 || response.status === 403 || /html/i.test(response.headers.get("content-type") ?? "")
    || /\/login(?:[/?#]|$)/i.test(response.url)) {
    throw new Error(loginMessage);
  }
  return response;
}

export async function readNotebookParquet(response: Response): Promise<ArrayBuffer> {
  const buffer = await response.arrayBuffer();
  if (/^\s*</.test(new TextDecoder().decode(buffer.slice(0, 512)))) throw new Error(loginMessage);
  return buffer;
}

export async function loadNotebookReport(path: string, signal?: AbortSignal): Promise<NotebookReportData> {
  const response = await fetchNotebookFile(notebookReportUrl(path), signal);
  if (!response.ok) throw new Error(`报告清单读取失败 (${response.status})`);
  const text = await response.text();
  if (/^\s*</.test(text)) throw new Error(loginMessage);
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch {
    throw new Error("报告清单 JSON 格式无效");
  }
  return parseNotebookReport(manifest, path);
}
