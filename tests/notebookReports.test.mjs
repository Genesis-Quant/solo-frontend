import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const factorFiles = ["information_coefficient", "group_returns"];
const backtestFiles = ["daily_portfolios", "trade_details", "daily_positions", "daily_trading_statistics"];
const path = "projects/factor/研究 X/reports/uuid/report.json";
const base = "/jupyter/solo/files/projects/factor/%E7%A0%94%E7%A9%B6%20X/reports/uuid";
const login = /登录 Jupyter/;

function load(relative, overrides = {}, globals = {}) {
  const filename = fileURLToPath(new URL(relative, import.meta.url));
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, TextDecoder, ...globals,
    require(name) {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name.startsWith(".") || name.startsWith("@/")) throw new Error(`Unexpected dependency: ${name}`);
      return require(name);
    }
  }, { filename });
  return module.exports;
}
const scheme = load("../src/assets/lib/scheme.ts");
function notebook(globals = {}) {
  return load("../src/assets/lib/notebookReports.ts", { "./scheme": scheme }, globals);
}
function reportModule(files, globals = {}) {
  return load("../src/assets/lib/reports.ts", {
    "./scheme": scheme, "./settings": { apiUrl: "/api/v1" }, "./notebookReports": files
  }, globals);
}
function manifest(kind = "factor", overrides = {}) {
  return {
    protocol: 1, format: "solo-notebook-report", schemeVersion: "1.2.3", kind, theme: "light",
    annualTradingDays: 252, riskFreeRate: 0,
    files: Object.fromEntries((kind === "factor" ? factorFiles : backtestFiles).map((name) => [name, `${name}.parquet`])),
    ...(kind === "factor" ? { parameters: {
      factor_columns: ["momentum"], return_columns: ["return_1", "log_5"],
      return_specs: { return_1: { kind: "simple", periods: 1 }, log_5: { kind: "log", periods: 5 } }, n_groups: 5, n_select: 10
    } } : {}),
    ...overrides
  };
}
const parser = notebook();

for (const kind of ["factor", "backtest"]) {
  test(`Notebook ${kind} manifest uses its own Scheme version, metadata and encoded sibling files`, () => {
    const input = manifest(kind, { theme: "dark", annualTradingDays: 240, riskFreeRate: 0.03 });
    const report = parser.parseNotebookReport(input, path);
    assert.equal(report.kind, kind);
    assert.equal(report.schemeVersion, "1.2.3");
    assert.equal(report.theme, "dark");
    assert.equal(report.annualTradingDays, 240);
    assert.equal(report.riskFreeRate, 0.03);
    for (const name of kind === "factor" ? factorFiles : backtestFiles) assert.equal(report.files[name], `${base}/${name}.parquet`);
    if (kind === "factor") assert.deepEqual(JSON.parse(JSON.stringify(report.parameters)), input.parameters);
    else assert.equal(report.parameters, undefined);
  });
}

test("Notebook dispatch supports all Scheme 1 minors but rejects missing, invalid and unknown majors", () => {
  for (const version of ["1.0.1", "v1.1.7", "1.2.3", "1.99.9"]) {
    assert.equal(parser.parseNotebookReport(manifest("factor", { schemeVersion: version }), path).schemeVersion, version);
  }
  for (const version of [undefined, null, 1, "bad", "1.2", "2.1.0"]) {
    assert.throws(() => parser.parseNotebookReport(manifest("factor", { schemeVersion: version }), path), /尚不支持 Scheme/);
  }
});

test("Notebook paths are root-relative, validated before fetch and encoded per segment", () => {
  assert.equal(parser.notebookReportUrl(path), `${base}/report.json`);
  assert.equal(parser.notebookReportUrl("projects/a?#%/report.json"), "/jupyter/solo/files/projects/a%3F%23%25/report.json");
  for (const invalid of ["", "/report.json", "projects//report.json", "./report.json", "../report.json", "projects/./report.json", "projects/../report.json", "projects/ /report.json", "projects\\report.json", "C:/report.json", "https://evil.test/report.json", "projects/\0/report.json", "projects/run.json", "projects/report.json/", null]) {
    assert.throws(() => parser.notebookReportUrl(invalid), /路径/);
  }
});

test("only safe, non-hidden sibling Parquet filenames are accepted, including optional files", () => {
  for (const file of ["factor.parquet", "group-returns_1.parquet", "result.v1.parquet"]) {
    assert.equal(parser.parseNotebookReport(manifest("factor", { files: { ...manifest().files, turnover: file } }), path).files.turnover, `${base}/${file}`);
  }
  for (const file of [".hidden.parquet", "..parquet", "a..b.parquet", "../x.parquet", "sub/x.parquet", "sub\\x.parquet", "C:x.parquet", "https://evil.test/x.parquet", "//evil.test/x.parquet", "a%2f.parquet", "a.parquet?token=x", "a.parquet#x", "a\0.parquet", "a.PARQUET", "a.json", "", null, 5]) {
    assert.throws(() => parser.parseNotebookReport(manifest("factor", { files: { ...manifest().files, turnover: file } }), path), /文件名无效/);
  }
});

test("Notebook and existing readV1 require exactly the same named files", () => {
  const existing = reportModule(parser);
  for (const kind of ["factor", "backtest"]) {
    const names = kind === "factor" ? factorFiles : backtestFiles;
    for (const missing of names) {
      const files = { ...manifest(kind).files };
      delete files[missing];
      assert.throws(() => parser.parseNotebookReport(manifest(kind, { files }), path), new RegExp(`缺少 ${missing}`));
      const input = kind === "factor" ? { kind, analysis: { columns: ["x"], return_periods: [1], groups: 5, n_select: 10 } } : { kind: "strategy" };
      assert.throws(() => existing.parseReport({ protocol: 1, status: "success", versions: { scheme: "1.2.3" }, report_kind: kind, input, reports: files }, "/reports/run", input.kind), new RegExp(`缺少 ${missing}`));
    }
  }
});

test("required Notebook protocol and metadata never silently default", () => {
  for (const field of ["protocol", "format", "kind", "theme", "annualTradingDays", "riskFreeRate", "files", "parameters"]) {
    const input = manifest();
    delete input[field];
    assert.throws(() => parser.parseNotebookReport(input, path), /报告/);
  }
  for (const changes of [
    { protocol: 2 }, { format: "run" }, { kind: "strategy" }, { theme: "auto" }, { files: [] },
    ...[0, -1, 1.5, Infinity, NaN, "252"].map((annualTradingDays) => ({ annualTradingDays })),
    ...[Infinity, -Infinity, NaN, "0", null].map((riskFreeRate) => ({ riskFreeRate }))
  ]) assert.throws(() => parser.parseNotebookReport(manifest("factor", changes), path), /报告/);
  assert.throws(() => parser.parseNotebookReport(manifest("backtest", { parameters: {} }), path), /仅适用于 factor/);
});

test("factor parameters validate columns, corresponding return specs and positive integer settings", () => {
  const good = manifest().parameters;
  for (const parameters of [
    null, [], {},
    ...[[], [""], [" "], ["x", "x"], [1], ["x\0"]].flatMap((value) => [{ ...good, factor_columns: value }, { ...good, return_columns: value }]),
    { ...good, return_specs: {} }, { ...good, return_specs: { ...good.return_specs, extra: { kind: "simple", periods: 1 } } },
    { ...good, return_specs: { return_1: { kind: "simple", periods: 1 }, other: { kind: "simple", periods: 5 } } },
    { ...good, return_specs: { ...good.return_specs, return_1: { kind: "unknown", periods: 1 } } },
    ...[0, -1, 1.5, NaN, Infinity, "1"].flatMap((value) => [
      { ...good, n_groups: value }, { ...good, n_select: value },
      { ...good, return_specs: { ...good.return_specs, return_1: { kind: "simple", periods: value } } }
    ])
  ]) assert.throws(() => parser.parseNotebookReport(manifest("factor", { parameters }), path), /报告/);
});

test("manifest and Parquet GETs forward decoded browser XSRF only on local Jupyter URLs", async () => {
  const calls = [];
  const files = notebook({ document: { cookie: "other=x; _xsrf=2%7Cbrowser-xsrf%7Ctimestamp; session=browser-cookie" }, fetch: async (url, options) => {
    calls.push({ url, options });
    return url.endsWith("report.json") ? Response.json(manifest()) : new Response("PAR1fixturePAR1");
  } });
  const controller = new AbortController();
  const report = await files.loadNotebookReport(path, controller.signal);
  const api = reportModule(files).reportApi(report);
  assert.deepEqual(JSON.parse(JSON.stringify(await api.outputs())), factorFiles.map((name) => ({ name })));
  assert.equal(new TextDecoder().decode(await api.output(0, "group_returns")), "PAR1fixturePAR1");
  assert.deepEqual(calls.map((call) => call.url), [`${base}/report.json`, `${base}/group_returns.parquet`]);
  assert.equal(calls[0].options.signal, controller.signal);
  for (const { options } of calls) {
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.redirect, "manual");
    assert.equal(options.headers["X-XSRFToken"], "2|browser-xsrf|timestamp");
    assert.deepEqual(Object.keys(options.headers), ["X-XSRFToken"]);
    assert.equal(options.headers.Origin, undefined);
    assert.equal(options.headers.Authorization, undefined);
  }
  for (const url of ["https://evil.test/jupyter/file", "//evil.test/jupyter/file", "https://127.0.0.1:5174/jupyter/file", "/api/v1/file", "/jupyter-evil/file"]) {
    await assert.rejects(files.fetchNotebookFile(url), /同源/);
  }
  assert.equal(calls.length, 2);
});

test("missing or malformed XSRF Cookie does not inject credentials, and non-Jupyter output never reads it", async () => {
  for (const cookie of ["", "_xsrf=", "_xsrf=%broken", "_xsrf=%0D%0Ainjected"]) {
    let options;
    const files = notebook({ document: { cookie }, fetch: async (_url, init) => { options = init; return Response.json(manifest()); } });
    await files.loadNotebookReport(path);
    assert.equal(options.headers, undefined);
  }
  const cause = new Error("cookie should not be read");
  const files = notebook({ document: { get cookie() { throw cause; } } });
  const calls = [];
  const api = reportModule(files, { fetch: async (...args) => { calls.push(args); return new Response("old-run-parquet"); } }).reportApi({ files: { x: "/api/v1/reports/run/x.parquet" } });
  assert.equal(new TextDecoder().decode(await api.output(7, "x")), "old-run-parquet");
  assert.deepEqual(calls, [["/api/v1/reports/run/x.parquet"]]);
  await assert.rejects(api.output(7, "missing"), /缺少 missing/);
});

function redirected(type, status = 0, url = "") {
  return { type, status, url, redirected: type === "followed", ok: status === 200, headers: new Headers() };
}
for (const [name, response] of [
  ["opaque login redirect", () => redirected("opaqueredirect")],
  ["HTTP redirect", () => new Response(null, { status: 302, headers: { location: "/login" } })],
  ["followed login redirect", () => redirected("followed", 200)],
  ["login URL", () => redirected("basic", 200, "http://127.0.0.1:5174/jupyter/login?next=report")],
  ["unauthenticated", () => new Response(null, { status: 401 })],
  ["XSRF or permission denial", () => new Response(null, { status: 403 })],
  ["HTML content type", () => new Response("<html>login</html>", { headers: { "content-type": "text/html; charset=UTF-8" } })],
  ["HTML with misleading content type", () => new Response("\ufeff \n<!DOCTYPE html><html>login</html>", { headers: { "content-type": "application/octet-stream" } })]
]) {
  test(`manifest and Parquet ${name} show an explicit Jupyter login message`, async () => {
    const files = notebook({ fetch: async () => response() });
    await assert.rejects(files.loadNotebookReport(path), login);
    const api = reportModule(files).reportApi(parser.parseNotebookReport(manifest(), path));
    await assert.rejects(api.output(0, "group_returns"), login);
  });
}

test("file errors and invalid JSON retain distinct, useful failures rather than becoming login or fallback reports", async () => {
  const files = notebook({ fetch: async () => new Response(null, { status: 404 }) });
  await assert.rejects(files.loadNotebookReport(path), /清单读取失败 \(404\)/);
  await assert.rejects(reportModule(files).reportApi(parser.parseNotebookReport(manifest(), path)).output(0, "group_returns"), /group_returns \(404\)/);
  const malformed = notebook({ fetch: async () => new Response("{broken") });
  await assert.rejects(malformed.loadNotebookReport(path), /JSON 格式无效/);
});

test("manifest and file fetch rejections preserve the exact reason, and manifest passes AbortSignal unchanged", async () => {
  for (const reason of [new TypeError("Failed to fetch"), "transport unavailable", null, undefined]) {
    const files = notebook({ fetch: async () => { throw reason; } });
    await assert.rejects(files.loadNotebookReport(path), (actual) => actual === reason);
    await assert.rejects(reportModule(files).reportApi(parser.parseNotebookReport(manifest(), path)).output(0, "group_returns"), (actual) => actual === reason);
  }
  const controller = new AbortController();
  const reason = new DOMException("cancelled", "AbortError");
  controller.abort(reason);
  const files = notebook({ fetch: async (_url, options) => {
    assert.equal(options.signal, controller.signal);
    throw options.signal.reason;
  } });
  await assert.rejects(files.loadNotebookReport(path, controller.signal), (actual) => actual === reason);
  let called = false;
  const noFetch = notebook({ fetch: async () => { called = true; } });
  await assert.rejects(noFetch.loadNotebookReport("../report.json"), /路径无效/);
  assert.equal(called, false);
});

test("legacy run manifests and report loading keep their original URL, project/version checks and defaults", async () => {
  const run = {
    protocol: 1, status: "success", versions: { scheme: "1.2.3" }, input: { kind: "strategy" },
    report_kind: "backtest", reports: manifest("backtest").files
  };
  const calls = [];
  const existing = reportModule(parser, { fetch: async (url, options) => { calls.push({ url, options }); return Response.json(run); } });
  const controller = new AbortController();
  const report = await existing.loadReportPath("/shared/runs/run/report", "strategy", "1.0.1", controller.signal);
  assert.equal(report.annualTradingDays, 252);
  assert.equal(report.riskFreeRate, 0);
  assert.equal(report.theme, undefined);
  assert.equal(report.files.daily_portfolios, "/api/v1/reports/run/report/daily_portfolios.parquet");
  assert.equal(calls[0].url, "/api/v1/reports/run/report/run.json");
  assert.equal(calls[0].options.signal, controller.signal);
  assert.deepEqual(Object.keys(calls[0].options), ["signal"]);
  await assert.rejects(existing.loadReportPath("run/report", "strategy", "2.1.0"), /尚不支持/);
  assert.throws(() => existing.parseReport(run, "/api/v1/reports/run/report", "factor"), /任务类型与项目不一致/);
});
