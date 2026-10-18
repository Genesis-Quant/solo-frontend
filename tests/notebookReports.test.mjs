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
const factorReturns = load("../src/assets/lib/factorReturns.ts");
function notebook(globals = {}) {
  return load("../src/assets/lib/notebookReports.ts", { "./scheme": scheme, "./factorReturns": factorReturns }, globals);
}
function reportModule(files, globals = {}) {
  return load("../src/assets/lib/reports.ts", {
    "./scheme": scheme, "./factorReturns": factorReturns, "./settings": { apiUrl: "/api/v1" }, "./notebookReports": files
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
function factorRun(analysis, schemeVersion = "1.2.3") {
  return {
    protocol: 1, status: "success", versions: { scheme: schemeVersion }, report_kind: "factor",
    input: { kind: "factor", analysis: { columns: ["momentum"], groups: 5, n_select: 10, ...analysis } },
    reports: { ...manifest().files, group_turnover: "group_turnover.parquet" }
  };
}

for (const kind of ["factor", "backtest"]) {
  test(`Notebook ${kind} manifest uses its own Scheme version, metadata and encoded sibling files`, () => {
    const input = manifest(kind, { theme: "dark", annualTradingDays: 240, riskFreeRate: 0.03 });
    const report = parser.parseNotebookReport(input, path);
    assert.equal(report.kind, kind);
    assert.equal(report.schemeVersion, "1.2.3");
    assert.equal(report.theme, "dark");
    assert.equal(report.annualTradingDays, kind === "backtest" ? 240 : 252);
    assert.equal(report.riskFreeRate, kind === "backtest" ? 0.03 : 0);
    for (const name of kind === "factor" ? factorFiles : backtestFiles) assert.equal(report.files[name], `${base}/${name}.parquet`);
    if (kind === "factor") assert.deepEqual(JSON.parse(JSON.stringify(report.parameters)), input.parameters);
    else assert.equal(report.parameters, undefined);
  });
}

test("Notebook dispatch supports all Scheme 1 minors but rejects missing, invalid and unknown majors", () => {
  for (const version of ["1", "1.2", "1.0.1", "1.1.7", "1.2.3", "1.99.9"]) {
    assert.equal(parser.parseNotebookReport(manifest("factor", { schemeVersion: version }), path).schemeVersion, version);
  }
  for (const version of [undefined, null, 1, "bad", "v1.2.3", "1.2.3rc1", "1.2.3.4", "2.1.0"]) {
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

test("report filenames only reject traversal, separators and controls, and encode Chinese and spaces", () => {
  const existing = reportModule(parser);
  for (const file of ["因子 收益.parquet", ".hidden.parquet", "..parquet", "a..b.parquet", "result.v1.parquet", "a%2f.parquet", "a.parquet?token=x", "a.parquet#x", "a.PARQUET", "a.data"]) {
    assert.equal(parser.parseNotebookReport(manifest("factor", { files: { ...manifest().files, turnover: file } }), path).files.turnover, `${base}/${encodeURIComponent(file)}`);
    const run = factorRun({ max_lag: 1 });
    run.reports.group_turnover = file;
    assert.equal(existing.parseReport(run, "/reports/run", "factor").files.group_turnover, `/reports/run/${encodeURIComponent(file)}`);
  }
  for (const file of [".", "..", "../x.parquet", "sub/x.parquet", "sub\\x.parquet", "C:x.parquet", "https://evil.test/x.parquet", "//evil.test/x.parquet", "a\0.parquet", "a\n.parquet", "a\u007f.parquet", "a\u0085.parquet", "", null, 5]) {
    assert.throws(() => parser.parseNotebookReport(manifest("factor", { files: { ...manifest().files, turnover: file } }), path), /文件名无效/);
    const run = factorRun({ max_lag: 1 });
    run.reports.group_turnover = file;
    assert.throws(() => existing.parseReport(run, "/reports/run", "factor"), /文件名无效/);
  }
});

test("factor manifests require their main files while backtest files are checked only when requested", async () => {
  const existing = reportModule(parser);
  for (const missing of factorFiles) {
    const files = { ...manifest().files };
    delete files[missing];
    assert.throws(() => parser.parseNotebookReport(manifest("factor", { files }), path), new RegExp(`缺少 ${missing}`));
    const run = factorRun({ max_lag: 1 });
    run.reports = files;
    assert.throws(() => existing.parseReport(run, "/reports/run", "factor"), new RegExp(`缺少 ${missing}`));
  }
  for (const files of [{}, { trade_details: "交易 明细.parquet" }, { daily_positions: "持仓.parquet" }]) {
    const report = parser.parseNotebookReport(manifest("backtest", { files }), path);
    assert.deepEqual(Object.keys(report.files), Object.keys(files));
    const run = { protocol: 1, status: "success", versions: { scheme: "1" }, report_kind: "backtest", input: { kind: "strategy" }, reports: files };
    assert.deepEqual(Object.keys(existing.parseReport(run, "/reports/run", "strategy").files), Object.keys(files));
    await assert.rejects(existing.reportApi(report).output(0, "daily_portfolios"), /缺少 daily_portfolios/);
  }
});

test("Notebook display defaults and backtest-only annual parameters are validated where used", () => {
  for (const field of ["protocol", "format", "kind", "files", "parameters"]) {
    const input = manifest();
    delete input[field];
    assert.throws(() => parser.parseNotebookReport(input, path), /报告/);
  }
  for (const kind of ["factor", "backtest"]) {
    const input = manifest(kind);
    for (const field of ["theme", "annualTradingDays", "riskFreeRate"]) delete input[field];
    const report = parser.parseNotebookReport(input, path);
    assert.equal(report.theme, "light");
    assert.equal(report.annualTradingDays, 252);
    assert.equal(report.riskFreeRate, 0);
  }
  for (const changes of [{ protocol: 2 }, { format: "run" }, { kind: "strategy" }, { theme: "auto" }, { files: [] }]) {
    assert.throws(() => parser.parseNotebookReport(manifest("factor", changes), path), /报告/);
  }
  for (const changes of [
    ...[0, -1, 1.5, Infinity, NaN, "252"].map((annualTradingDays) => ({ annualTradingDays })),
    ...[Infinity, -Infinity, NaN, "0"].map((riskFreeRate) => ({ riskFreeRate }))
  ]) {
    assert.throws(() => parser.parseNotebookReport(manifest("backtest", changes), path), /报告/);
    assert.doesNotThrow(() => parser.parseNotebookReport(manifest("factor", changes), path));
  }
  assert.throws(() => parser.parseNotebookReport(manifest("backtest", { parameters: {} }), path), /仅适用于 factor/);
});

test("factor parameters validate columns, corresponding return specs and positive integer settings", () => {
  const good = manifest().parameters;
  for (const parameters of [
    null, [], {},
    ...[[], [""], [" "], ["x", "x"], [1], ["x\0"]].flatMap((value) => [{ ...good, factor_columns: value }, { ...good, return_columns: value }]),
    { ...good, return_specs: {} },
    { ...good, return_specs: { return_1: { kind: "simple", periods: 1 }, other: { kind: "simple", periods: 5 } } },
    { ...good, return_specs: { ...good.return_specs, return_1: { kind: "unknown", periods: 1 } } },
    ...[0, -1, 1.5, NaN, Infinity, "1"].flatMap((value) => [
      { ...good, n_groups: value }, { ...good, n_select: value },
      { ...good, return_specs: { ...good.return_specs, return_1: { kind: "simple", periods: value } } }
    ])
  ]) assert.throws(() => parser.parseNotebookReport(manifest("factor", { parameters }), path), /报告/);
});

for (const [maxLag, expectedColumns] of [
  [1, ["r0o", "r1"]],
  [2, ["r0o", "r1", "r1o", "r2"]],
  [3, ["r0o", "r1", "r1o", "r2", "r2o", "r3"]]
]) {
  test(`factor max_lag=${maxLag} generates ordered single-segment specs and round-trips Notebook metadata`, () => {
    const existing = reportModule(parser);
    const report = existing.parseReport(factorRun({ max_lag: maxLag }), "/reports/factor", "factor");
    const parameters = JSON.parse(JSON.stringify(report.parameters));
    assert.deepEqual(parameters.return_columns, expectedColumns);
    assert.deepEqual(Object.keys(parameters.return_specs), expectedColumns);
    for (const [index, column] of expectedColumns.entries()) {
      const k = Math.floor(index / 2) + 1;
      assert.deepEqual(parameters.return_specs[column], {
        kind: "simple", periods: 1, lag: index % 2 === 0 ? k - 1 : k,
        session: index % 2 === 0 ? "overnight" : "intraday", turnover_period: k
      });
    }
    assert.equal(report.annualTradingDays, 252);
    assert.equal(report.files.group_turnover, "/reports/factor/group_turnover.parquet");
    const roundTrip = parser.parseNotebookReport(JSON.parse(JSON.stringify(manifest("factor", { parameters }))), path);
    assert.deepEqual(JSON.parse(JSON.stringify(roundTrip.parameters)), parameters);
  });
}

test("factor max_lag rejects invalid values and ambiguous or missing analysis without defaulting", () => {
  const existing = reportModule(parser);
  for (const maxLag of [undefined, null, false, true, "2", 0, -1, 1.5, NaN, Infinity, -Infinity, [], {}, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => existing.parseReport(factorRun({ max_lag: maxLag }), "/reports/factor", "factor"), /max_lag.*正整数/);
  }
  for (const returnPeriods of [[1, 2], [], null, undefined]) {
    assert.throws(() => existing.parseReport(factorRun({ max_lag: 2, return_periods: returnPeriods }), "/reports/factor", "factor"), /不能同时提供/);
  }
  assert.throws(() => existing.parseReport(factorRun({}), "/reports/factor", "factor"), /缺少收益持有期/);
});

test("legacy factor return_periods retain their close-to-close durations and no lag metadata", () => {
  const existing = reportModule(parser);
  const report = existing.parseReport(factorRun({ return_periods: [3, 1, 2] }), "/reports/factor", "factor");
  const expected = {
    factor_columns: ["momentum"], return_columns: ["return_3", "return_1", "return_2"],
    return_specs: { return_3: { kind: "simple", periods: 3 }, return_1: { kind: "simple", periods: 1 }, return_2: { kind: "simple", periods: 2 } },
    n_groups: 5, n_select: 10
  };
  assert.deepEqual(JSON.parse(JSON.stringify(report.parameters)), expected);
  assert.deepEqual(JSON.parse(JSON.stringify(parser.parseNotebookReport(manifest("factor", { parameters: expected }), path).parameters)), expected);
  for (const returnPeriods of [undefined, null, [], [0], [-1], [1.5], ["2"], [NaN], [Infinity]]) {
    assert.throws(() => existing.parseReport(factorRun({ return_periods: returnPeriods }), "/reports/factor", "factor"), /报告/);
  }
});

test("provided lag and session metadata match the label and single-segment duration", () => {
  const good = {
    factor_columns: ["momentum"], ...JSON.parse(JSON.stringify(factorReturns.laggedReturns(2))), n_groups: 5, n_select: 10
  };
  const valid = good.return_specs.r1o;
  const invalid = [
    ...[null, -1, 0, 1.5, "1", Infinity, NaN].map((lag) => ({ ...valid, lag })),
    ...[null, "night", "intraday"].map((session) => ({ ...valid, session })),
    ...[null, 0, -1, 1.5, "2", Infinity, NaN].map((turnover_period) => ({ ...valid, turnover_period })),
    { ...valid, kind: "log" }, { ...valid, periods: 2 },
    { kind: "simple", periods: 1, lag: 0, session: "intraday", turnover_period: 1 }
  ];
  for (const spec of invalid) {
    assert.throws(() => parser.parseNotebookReport(manifest("factor", { parameters: {
      ...good, return_specs: { ...good.return_specs, r1o: spec }
    } }), path), /报告收益时段规格与标签不一致/);
  }
  for (const column of ["return_1", "r01o", "r1", "custom"]) {
    assert.throws(() => parser.parseNotebookReport(manifest("factor", { parameters: {
      ...good, return_columns: [column], return_specs: { [column]: valid }
    } }), path), /报告收益时段规格与标签不一致/);
  }
});

test("extra return specs are ignored and display metadata can be partial and independent of turnover intervals", () => {
  const good = { factor_columns: ["momentum"], ...JSON.parse(JSON.stringify(factorReturns.laggedReturns(2))), n_groups: 5, n_select: 10 };
  for (const metadata of [{}, { lag: 1 }, { session: "overnight" }, { lag: 1, session: "overnight" }, { turnover_period: 7 }, { lag: 1, session: "overnight", turnover_period: 7 }]) {
    const spec = { kind: "simple", periods: 1, ...metadata };
    const parameters = { ...good, return_specs: { ...good.return_specs, r1o: spec, extra: { kind: "unused" } } };
    const report = parser.parseNotebookReport(manifest("factor", { parameters }), path);
    assert.deepEqual(JSON.parse(JSON.stringify(report.parameters.return_specs.r1o)), spec);
    assert.equal(Object.hasOwn(report.parameters.return_specs, "extra"), false);
  }
});

test("Notebook reports without metadata keep their declared specs even when column names contain numbers", () => {
  const parameters = { factor_columns: ["momentum"], return_columns: ["r1o", "custom_30"],
    return_specs: { r1o: { kind: "log", periods: 5 }, custom_30: { kind: "simple", periods: 1 } }, n_groups: 5, n_select: 10 };
  assert.deepEqual(JSON.parse(JSON.stringify(parser.parseNotebookReport(manifest("factor", { parameters }), path).parameters)), parameters);
});

for (const [version, kind] of [["1.9.9", "simple"], ["1.10.0", "log"]]) {
  for (const price of ["open", "close", "open_hfq", "close_hfq"]) {
    test(`Scheme ${version} price analysis generates exact P5L1..3 ${price} ${kind} specs and preserves them in Notebook`, () => {
      const report = reportModule(parser).parseReport(factorRun({ period: 5, price_column: price, max_lag: 3 }, version), "/reports/price", "factor");
      const parameters = JSON.parse(JSON.stringify(report.parameters));
      assert.deepEqual(parameters.return_columns, ["P5L1", "P5L2", "P5L3"]);
      for (let lag = 1; lag <= 3; lag++) assert.deepEqual(parameters.return_specs[`P5L${lag}`], {
        kind, periods: 5, lag, price_column: price, turnover_period: 5
      });
      assert.deepEqual(JSON.parse(JSON.stringify(parser.parseNotebookReport(manifest("factor", { parameters }), path).parameters)), parameters);
      assert.ok(parameters.return_columns.every((column) => !/^(r\d|return_|t)/.test(column)));
    });
  }
}

test("price generation defaults to log and explicit kind changes no labels or turnover metadata", () => {
  const current = JSON.parse(JSON.stringify(factorReturns.priceReturns(5, "close_hfq", 3)));
  for (const kind of ["simple", "log"]) {
    const expected = { ...current, return_specs: Object.fromEntries(Object.entries(current.return_specs).map(([column, spec]) => [column, { ...spec, kind }])) };
    assert.deepEqual(JSON.parse(JSON.stringify(factorReturns.priceReturns(5, "close_hfq", 3, kind))), expected);
  }
  for (const spec of Object.values(current.return_specs)) assert.equal(spec.kind, "log");
  assert.throws(() => factorReturns.priceReturns(5, "close_hfq", 3, "unknown"), /报告收益类型无效/);
});

test("price generation requires complete valid inputs and never substitutes a legacy label", () => {
  for (const [period, price, lag] of [
    [5, undefined, 3], [undefined, "close", 3], [5, "close", undefined],
    ...[undefined, null, false, true, "5", 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].flatMap((value) => [[value, "open", 3], [5, "open", value]]),
    ...[undefined, null, "", "OPEN", "vwap", "adj_close", 1, {}].map((price) => [5, price, 3])
  ]) assert.throws(() => factorReturns.priceReturns(period, price, lag), /报告/);
});

test("any new analysis field requires the complete price contract without a legacy fallback", () => {
  const existing = reportModule(parser);
  const good = { period: 5, price_column: "open_hfq", max_lag: 3 };
  for (const analysis of [
    { period: 5 }, { price_column: "close" }, { period: 5, max_lag: 3 }, { price_column: "close", max_lag: 3 }, { period: 5, price_column: "close" },
    ...[undefined, null, false, true, "5", 0, -1, 1.5, NaN, Infinity].flatMap((value) => [{ ...good, period: value }, { ...good, max_lag: value }]),
    ...[undefined, null, "", "OPEN", "vwap", 1].map((price_column) => ({ ...good, price_column })),
    { ...good, return_periods: [1, 5] }
  ]) assert.throws(() => existing.parseReport(factorRun(analysis), "/reports/price", "factor"), /报告/);
});

test("Notebook price metadata preserves each explicit kind regardless of version, column name or turnover mapping", () => {
  for (const schemeVersion of ["1.9.9", "1.10.0", "1.99.0"]) {
    for (const kind of ["simple", "log"]) {
      const parameters = { factor_columns: ["first", "second"], return_columns: ["custom_99", "P1L100", "one_day"], n_groups: 2, n_select: 10,
        return_specs: {
          custom_99: { kind, periods: 5, lag: 2, price_column: "close_hfq", turnover_period: 7 },
          P1L100: { kind: kind === "simple" ? "log" : "simple", periods: 3, lag: 1, price_column: "open" },
          one_day: { kind, periods: 1, lag: 3, price_column: "close", turnover_period: 1 }
        } };
      assert.deepEqual(JSON.parse(JSON.stringify(parser.parseNotebookReport(manifest("factor", { schemeVersion, parameters }), path).parameters)), parameters);
    }
  }
});

test("new Notebook price metadata rejects incomplete or illegal specs without a label-based fallback", () => {
  const good = { kind: "log", periods: 5, lag: 1, price_column: "open_hfq", turnover_period: 5 };
  for (const spec of [
    ...[undefined, null, false, true, 0, -1, 1.5, "1", Infinity, NaN, Number.MAX_SAFE_INTEGER + 1].flatMap((value) => [{ ...good, lag: value }, { ...good, periods: value }]),
    ...[undefined, null, "", "vwap", "OPEN", 1, {}].map((price_column) => ({ ...good, price_column })),
    ...[null, 0, -1, 1.5, "1", Infinity, Number.MAX_SAFE_INTEGER + 1].map((turnover_period) => ({ ...good, turnover_period })),
    { ...good, kind: "unknown" }, { ...good, session: "intraday" }, { ...good, session: undefined }
  ]) assert.throws(() => parser.parseNotebookReport(manifest("factor", { parameters: {
    factor_columns: ["factor"], return_columns: ["P5L1"], return_specs: { P5L1: spec }, n_groups: 2, n_select: 10
  } }), path), /报告/);
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
