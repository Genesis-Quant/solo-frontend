import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

// Compile the real analytics/JSX with isolated data sources; no browser or database is contacted.
function load(relative, overrides = {}, extra = "") {
  const filename = fileURLToPath(new URL(relative, import.meta.url));
  const compiled = ts.transpileModule(readFileSync(filename, "utf8") + extra, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    require(name) {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name.startsWith("@/ui/")) return new Proxy({}, { get: (_target, key) => key });
      if (name.startsWith(".") || name.startsWith("@/") || name.startsWith("~icons/")) throw new Error(`Unexpected dependency: ${name}`);
      return require(name);
    }
  }, { filename });
  return module.exports;
}

const { laggedReturns } = load("../src/assets/lib/factorReturns.ts");
function parameters(maxLag = 3) {
  return { factor_columns: ["momentum_7"], ...laggedReturns(maxLag), n_groups: 2, n_select: 10 };
}
async function analyticsFixture(input = parameters(), turnover = true) {
  const queries = [];
  const database = { async rows(sql) {
    queries.push(sql);
    return sql.includes("SELECT DISTINCT periods") ? [{ periods: 1 }, { periods: 2 }, { periods: 3 }] : [];
  }, async close() {} };
  const { FactorAnalytics } = load("../src/assets/lib/factorAnalysis.ts", {
    "@/assets/lib/duckdb": { BrowserDuckDb: { create: async () => database }, duckDbDateValue: String }
  });
  const session = await FactorAnalytics.create(7, {
    information: new ArrayBuffer(0), groups: new ArrayBuffer(0), turnover: turnover ? new ArrayBuffer(0) : null
  }, input);
  return { session, queries };
}

test("new labels reach SQL verbatim and all use single-period compounding and 252 daily observations", async () => {
  const input = parameters();
  const { session, queries } = await analyticsFixture(input);
  assert.equal(queries.length, 0, "creating analytics does not compute unused whole-report summaries");
  for (const column of input.return_columns) {
    await session.informationSeries("momentum_7", column);
    assert.ok(queries.at(-1).includes(`"momentum_7_${column}_ic"`));
    assert.ok(queries.at(-1).includes(`"momentum_7_${column}_rank_ic"`));
    await session.longShortSeries("momentum_7", column);
    assert.ok(queries.at(-1).includes(`"momentum_7_${column}_top" - "momentum_7_${column}_bottom"`));
    assert.match(queries.at(-1), /product\(1 \+ raw_value\)/);
    assert.doesNotMatch(queries.at(-1), /NULL::DOUBLE/);
    await session.groupSeries("momentum_7", column, input.n_groups);
    assert.ok(queries.at(-1).includes(`product(1 + "momentum_7_${column}_group0")`));
    assert.doesNotMatch(queries.at(-1), /NULL::DOUBLE/);
  }
  const decay = await session.decay("momentum_7", input.return_columns);
  assert.deepEqual(Array.from(decay, (point) => point.label), Array.from(input.return_columns));
  assert.deepEqual(Array.from(decay, (point) => point.position), [0, 1, 2, 3, 4, 5]);
});

test("legacy and custom labels use declared periods rather than parsing digits from column names", async () => {
  const input = { factor_columns: ["momentum_7"], return_columns: ["return_2", "r3", "custom_30"],
    return_specs: { return_2: { kind: "simple", periods: 2 }, r3: { kind: "log", periods: 5 }, custom_30: { kind: "simple", periods: 1 } },
    n_groups: 2, n_select: 10 };
  const { session, queries } = await analyticsFixture(input);
  for (const column of ["return_2", "r3"]) {
    await session.longShortSeries("momentum_7", column);
    assert.match(queries.at(-1), /NULL::DOUBLE AS cumulative/);
    await session.groupSeries("momentum_7", column, 2);
    assert.match(queries.at(-1), /NULL::DOUBLE AS "series_0"/);
  }
  await session.longShortSeries("momentum_7", "custom_30");
  assert.match(queries.at(-1), /product\(1 \+ raw_value\)/);
});

for (const kind of ["simple", "log"]) {
  test(`${kind} cumulative SQL leaves trailing and intermediate return gaps in both curve directions`, async () => {
    const duckdb = require("@duckdb/duckdb-wasm/blocking");
    const modulePath = (variant) => fileURLToPath(new URL(`../node_modules/@duckdb/duckdb-wasm/dist/duckdb-${variant}.wasm`, import.meta.url));
    const db = await duckdb.createDuckDB({ mvp: { mainModule: modulePath("mvp") }, eh: { mainModule: modulePath("eh") } }, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
    await db.instantiate();
    const connection = db.connect();
    try {
      connection.query("SET autoinstall_known_extensions = false");
      connection.query("SET autoload_known_extensions = false");
      const columns = ["bottom", "group0", "group1", "top"].map((group) => `momentum_7_r3_${group}`);
      const returns = [[0.01, 0.02, 0.03, 0.04], [null, null, 0.05, 0.06], [0.02, 0.04, 0.06, 0.08], [null, null, null, null], [null, null, null, null]];
      const times = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"];
      connection.query(`CREATE TABLE returns (time VARCHAR, ${columns.map((column) => `"${column}" DOUBLE`).join(", ")})`);
      connection.query(`INSERT INTO returns VALUES ${returns.map((values, index) => `('${times[index]}', ${values.map((value) => value === null ? "NULL" : value).join(", ")})`).join(", ")}`);
      const { FactorAnalytics } = load("../src/assets/lib/factorAnalysis.ts", {
        "@/assets/lib/duckdb": { BrowserDuckDb: { create: async () => ({
          async rows(sql) { return connection.query(sql.replace("read_parquet('factor-7-groups.parquet')", "returns")).toArray().map((row) => row.toJSON()); }
        }) }, duckDbDateValue: String }
      });
      const input = parameters(3);
      input.return_specs.r3.kind = kind;
      const session = await FactorAnalytics.create(7, { information: new ArrayBuffer(0), groups: new ArrayBuffer(0) }, input);
      const longShort = await session.longShortSeries("momentum_7", "r3");
      assert.deepEqual(Array.from(longShort, (point) => point.time), times);
      assert.deepEqual(Array.from(longShort, (point) => point.value === null), [false, true, false, true, true]);
      assert.deepEqual(Array.from(longShort, (point) => point.cumulative === null), [false, true, false, true, true]);
      const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
      close(longShort[0].cumulative, kind === "log" ? Math.exp(0.03) - 1 : 0.03);
      close(longShort[2].cumulative, kind === "log" ? Math.exp(0.09) - 1 : 1.03 * 1.06 - 1);
      const groups = await session.groupSeries("momentum_7", "r3", input.n_groups);
      for (const [column, label] of ["最小 10 支", "Group 1", "Group 2", "最大 10 支"].entries()) {
        for (const direction of ["values", "reverseValues"]) {
          let cumulative = kind === "log" ? 0 : 1;
          const indices = times.map((_time, index) => index);
          if (direction === "reverseValues") indices.reverse();
          for (const index of indices) {
            const value = returns[index][column];
            if (value === null) assert.equal(groups[index][direction][label], null);
            else {
              cumulative = kind === "log" ? cumulative + value : cumulative * (1 + value);
              close(groups[index][direction][label], kind === "log" ? Math.exp(cumulative) : cumulative);
            }
          }
        }
      }
    } finally {
      connection.close();
      db.reset();
    }
  });
}

test("turnover comparison intervals come only from their own Parquet and remain independent of return selection", async () => {
  const { session, queries } = await analyticsFixture();
  assert.deepEqual(Array.from(await session.turnoverPeriods("momentum_7")), [1, 2, 3]);
  assert.match(queries.at(-1), /SELECT DISTINCT periods FROM read_parquet\('factor-7-turnover\.parquet'\)/);
  for (const column of ["r0o", "r3"]) {
    await session.longShortSeries("momentum_7", column);
    const summary = await session.turnoverSummary("momentum_7", 2, 2);
    assert.equal(summary.periods, 2);
    assert.match(queries.at(-1), /factor = 'momentum_7' AND periods = 2/);
    assert.doesNotMatch(queries.at(-1), /r0o|r3|return_column|turnover_period/);
  }
  const missing = await analyticsFixture(parameters(), false);
  assert.deepEqual(Array.from(await missing.session.turnoverPeriods("momentum_7")), []);
  assert.equal((await missing.session.turnoverSummary("momentum_7", 2, 2)).periods, 2);
  assert.equal(missing.queries.length, 0);
});

const panel = load("../src/components/panel/FactorAnalysisReport.tsx", {
  "@/assets/lib/reports": { useReportApi: () => { throw new Error("Unexpected report request"); } },
  "@/assets/lib/chart": {}, "@/assets/lib/utils": {}, "@/assets/lib/factorAnalysis": {},
  "@/components/bar/DateRangeBar": { __esModule: true, default: "DateRangeBar" },
  "@/components/chart/EChart": { __esModule: true, default: "EChart" },
  "@/components/card/SortableCardStack": { __esModule: true, default: "SortableCardStack" },
  "@/store": {},
  "~icons/lucide/database": { __esModule: true, default: "IconDatabase" },
  "~icons/lucide/loader-circle": { __esModule: true, default: "IconLoaderCircle" }
}, "\nexport { LaggedReturnNotice, ReturnContract, OverlappingReturnNotice, returnMetrics, maxDrawdown, longShortOption, returnPeriodsOf };");
function text(Component, props) {
  return renderToStaticMarkup(React.createElement(Component, props)).replace(/<[^>]+>/g, "");
}

test("N=2 report notice explains four simple segments over three trading days without changing the annual model", () => {
  const notice = text(panel.LaggedReturnNotice, { specs: parameters(2).return_specs });
  assert.match(notice, /N=2.*t 至 t\+2.*3 个交易日（N\+1）.*4 个单段简单收益/);
  assert.match(notice, /r\{k-1\}o 为隔夜 C_adj\(t\+k-1\) → O_adj\(t\+k\)/);
  assert.match(notice, /r\{k\} 为日内 O_adj\(t\+k\) → C_adj\(t\+k\)/);
  assert.match(notice, /终价 \/ 初价 − 1/);
  assert.match(notice, /periods=1.*每个交易日一条观测.*252 个交易日/);
  assert.match(notice, /换手比较间隔独立于收益时段/);
  assert.equal(text(panel.LaggedReturnNotice, { specs: { return_2: { kind: "simple", periods: 2 } } }), "");
});

test("selected new return specs display the exact adjusted overnight and intraday intervals", () => {
  const specs = parameters(2).return_specs;
  for (const [column, interval] of [
    ["r0o", "隔夜 C_adj(t) → O_adj(t+1)"], ["r1", "日内 O_adj(t+1) → C_adj(t+1)"],
    ["r1o", "隔夜 C_adj(t+1) → O_adj(t+2)"], ["r2", "日内 O_adj(t+2) → C_adj(t+2)"]
  ]) {
    const contract = text(panel.ReturnContract, { spec: specs[column] });
    assert.ok(contract.includes(interval));
    assert.match(contract, /简单收益.*1 期.*可复利/);
    assert.equal(text(panel.OverlappingReturnNotice, { periods: specs[column].periods }), "");
    assert.equal(panel.returnPeriodsOf(parameters(2), column), 1);
  }
  const legacy = text(panel.ReturnContract, { spec: { kind: "simple", periods: 2 } });
  assert.match(legacy, /简单收益2 期重叠 · 不可复利/);
  assert.doesNotMatch(legacy, /隔夜|日内|C_adj|O_adj/);
  assert.match(text(panel.OverlappingReturnNotice, { periods: 2 }), /相邻观测存在重叠/);
});

function reportElements(tree, name) {
  if (Array.isArray(tree)) return tree.flatMap((node) => reportElements(node, name));
  if (!React.isValidElement(tree)) return [];
  return [...(tree.type === name || tree.type.name === name ? [tree] : []), ...reportElements(tree.props.children, name)];
}
function reportFixture(relative, overrides, props) {
  const slots = [];
  let cursor = 0, effects = [], tree, queued = false, closed = false;
  const hooks = { ...React,
    useState(initial) {
      const slot = slots[cursor++] ??= { value: typeof initial === "function" ? initial() : initial };
      return [slot.value, (update) => {
        const value = typeof update === "function" ? update(slot.value) : update;
        if (!closed && !Object.is(value, slot.value)) { slot.value = value; schedule(); }
      }];
    },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useEffect(callback, deps) {
      const slot = slots[cursor++] ??= {};
      if (!slot.deps || deps.some((value, index) => !Object.is(value, slot.deps[index]))) {
        slot.deps = deps;
        effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); });
      }
    },
    useMemo(factory, deps) {
      const slot = slots[cursor++] ??= {};
      if (!slot.deps || deps.some((value, index) => !Object.is(value, slot.deps[index]))) {
        slot.deps = deps; slot.value = factory();
      }
      return slot.value;
    },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); }
  };
  hooks.useLayoutEffect = hooks.useEffect;
  function schedule() {
    if (queued || closed) return;
    queued = true;
    queueMicrotask(() => { queued = false; if (!closed) render(); });
  }
  const Component = load(relative, { react: hooks,
    "@/assets/lib/chart": { thresholdMarkLine: () => ({}) }, "@/assets/lib/utils": { errorMessage: (reason) => reason.message },
    "@/components/bar/DateRangeBar": { __esModule: true, default: "DateRangeBar" },
    "@/components/chart/EChart": { __esModule: true, default: "EChart" },
    "@/components/card/SortableCardStack": { __esModule: true, default: "SortableCardStack" },
    "@/components/table/ParquetDataTable": { __esModule: true, default: "ParquetDataTable" },
    "@/store": { useAppStore: () => "light" },
    "~icons/lucide/database": { __esModule: true, default: "IconDatabase" },
    "~icons/lucide/loader-circle": { __esModule: true, default: "IconLoaderCircle" },
    ...overrides
  }).default;
  function render() {
    cursor = 0; effects = []; tree = Component(props);
    effects.splice(0).forEach((effect) => effect());
  }
  render();
  return {
    get tree() { return tree; },
    nodes(name) { return reportElements(tree, name); },
    card(id) { return reportElements(tree, "SortableCardStack")[0].props.items.find((card) => card.id === id).content; },
    update(changes) { props = { ...props, ...changes }; render(); },
    settle: async () => { for (let index = 0; index < 5; index++) await new Promise(setImmediate); },
    close() { closed = true; slots.forEach((slot) => slot.cleanup?.()); }
  };
}

for (const failure of ["download", "query"]) {
  test(`optional factor ${failure} errors stay in their cards and one-point main charts still render`, async () => {
    const time = "2026-01-05", calls = [];
    const session = {
      async informationSeries() { return [{ time, ic: 0.2, rankIc: 0.3, icCumulative: 0.2, rankIcCumulative: 0.3 }]; },
      async longShortSeries() { return [{ time, value: 0.01, cumulative: 0.01 }]; },
      async groupSeries() { return [{ time, values: { "Group 1": 1.01 }, reverseValues: { "Group 1": 1.01 } }]; },
      async groupStatistics() { return [{ group: "Group 1", mean: 0.01, pValue: null }]; },
      async decay() { return []; },
      async turnoverPeriods() { if (failure === "query") throw new Error("turnover query failed"); return []; },
      async executionStatistics() { if (failure === "query") throw new Error("statistics query failed"); return []; },
      async close() {}
    };
    const api = {
      async outputs() { return ["information_coefficient", "group_returns", "group_turnover", "execution_statistics"].map((name) => ({ name })); },
      async output(_id, name) {
        calls.push(name);
        if (failure === "download" && !["information_coefficient", "group_returns"].includes(name)) throw new Error(`${name} download failed`);
        return new ArrayBuffer(0);
      }
    };
    const app = reportFixture("../src/components/panel/FactorAnalysisReport.tsx", {
      "@/assets/lib/reports": { useReportApi: () => api },
      "@/assets/lib/factorAnalysis": { FactorAnalytics: { create: async () => session } }
    }, { parameters: parameters(1), factor: "momentum_7", workflowInstanceId: 7 });
    try {
      await app.settle();
      for (const id of ["information", "returns", "groups"]) assert.equal(reportElements(app.card(id), "EChart").length, id === "groups" ? 2 : 1);
      assert.match(reportElements(app.card("turnover"), "SeriesContent")[0].props.error, failure === "download" ? /group_turnover download failed/ : /turnover query failed/);
      assert.match(reportElements(app.card("execution-statistics"), "SeriesContent")[0].props.error, failure === "download" ? /execution_statistics download failed/ : /statistics query failed/);
      assert.equal(app.tree.type, "section");
      assert.equal(calls.length, 4);
    } finally { app.close(); }
  });
}

for (const retry of ["factor", "dates", "period"]) {
  test(`optional factor queries clear earlier errors when ${retry} changes start a new query`, async () => {
    const time = "2026-01-05";
    let fail = true, retryPending = false;
    const requests = [];
    const query = (name, value) => {
      if (fail) return Promise.reject(new Error(`${name} failed`));
      if (retryPending) return new Promise((resolve) => requests.push(() => resolve(value)));
      return Promise.resolve(value);
    };
    const session = {
      async informationSeries() { return [{ time, ic: 0.2, rankIc: 0.3, icCumulative: 0.2, rankIcCumulative: 0.3 }]; },
      async longShortSeries() { return [{ time, value: 0.01, cumulative: 0.01 }]; },
      async groupSeries() { return []; }, async groupStatistics() { return []; }, async decay() { return []; },
      turnoverPeriods() { return query("periods", [1, 2]); },
      turnoverSummary() { return query("turnover", { periods: 1, rankAutocorrelation: 0.5, groups: [{ group: "Group 1", value: 0.2 }] }); },
      executionStatistics() { return query("statistics", [{ time, sourceCount: 10, filteredCount: 8, filters: [] }]); },
      async close() {}
    };
    const api = { async outputs() { return []; }, async output() { return new ArrayBuffer(0); } };
    const app = reportFixture("../src/components/panel/FactorAnalysisReport.tsx", {
      "@/assets/lib/reports": { useReportApi: () => api },
      "@/assets/lib/factorAnalysis": { FactorAnalytics: { create: async () => session } }
    }, { parameters: parameters(1), factor: "momentum_7", workflowInstanceId: 7 });
    const content = (id) => reportElements(app.card(id), "SeriesContent")[0].props;
    try {
      await app.settle();
      assert.match(content("turnover").error, /periods failed/);
      assert.match(content("execution-statistics").error, /statistics failed/);
      fail = false;
      app.update({ factor: "momentum_8" }); await app.settle();
      assert.equal(content("turnover").error, "");
      assert.equal(content("execution-statistics").error, "");
      assert.equal(reportElements(app.card("turnover"), "EChart").length, 1);
      assert.equal(reportElements(app.card("execution-statistics"), "EChart").length, 1);
      fail = true;
      app.nodes("DateRangeBar")[0].props.onRangeChange(time, "2026-01-06"); await app.settle();
      assert.match(content("turnover").error, /turnover failed/);
      assert.match(content("execution-statistics").error, /statistics failed/);
      fail = false; retryPending = true;
      if (retry === "factor") app.update({ factor: "momentum_9" });
      else if (retry === "dates") app.nodes("DateRangeBar")[0].props.onRangeChange(time, "2026-01-07");
      else reportElements(app.card("turnover"), "CardToolbar")[0].props.end.props.onValueChange("2");
      await app.settle();
      assert.equal(content("turnover").error, "", "turnover errors clear before the retry resolves");
      if (retry !== "period") assert.equal(content("execution-statistics").error, "", "statistics errors clear before the retry resolves");
      retryPending = false;
      requests.splice(0).forEach((resolve) => resolve()); await app.settle();
      assert.equal(content("turnover").error, "");
      assert.equal(reportElements(app.card("turnover"), "EChart").length, 1);
      if (retry !== "period") assert.equal(reportElements(app.card("execution-statistics"), "EChart").length, 1);
    } finally { app.close(); }
  });
}

for (const initialTab of ["overview", "trade_details", "daily_positions", "daily_trading_statistics"]) {
  test(`backtest ${initialTab} loads requested files independently of a failed portfolio overview`, async () => {
    const calls = [], registrations = new Set(), pages = [];
    const session = {
      isRegistered: (name) => registrations.has(name),
      async register(name) { registrations.add(name); },
      async portfolios() { throw new Error("portfolio query failed"); },
      async tablePage(name, _page, _size, range) { pages.push({ name, range }); return { columns: [], rows: [{ tradeId: 1 }], numericStats: {}, total: 1 }; },
      async close() {}
    };
    const api = { async output(_id, name) { calls.push(name); if (name === "daily_portfolios") throw new Error("portfolio unavailable"); return new ArrayBuffer(0); } };
    const app = reportFixture("../src/components/panel/BacktestReport.tsx", {
      "@/assets/lib/reports": { useReportApi: () => api },
      "@/assets/lib/backtestAnalysis": { BacktestAnalytics: { create: async () => session }, backtestTableTimeColumns: {} },
      "@/assets/lib/backtestTable": { backtestTableConfigs: {} },
      "@/assets/lib/quantstats": {},
      "@/types/table": { emptyParquetTableQuery: () => ({ filters: [], sorting: [] }) }
    }, { activeTab: initialTab, annualTradingDays: 252, riskFreeRate: 0, workflowInstanceId: 7 });
    try {
      await app.settle();
      for (const tab of app.nodes("TabsTrigger")) assert.notEqual(tab.props.disabled, true);
      if (initialTab === "overview") {
        assert.deepEqual(calls, ["daily_portfolios"]);
        app.update({ activeTab: "trade_details" });
        await app.settle();
      } else assert.deepEqual(calls, [initialTab], "opening a detail page must not request the overview file");
      const detail = app.nodes("TabsContent").find((tab) => tab.props.value === (initialTab === "overview" ? "trade_details" : initialTab));
      assert.equal(detail.props.children.type, "ParquetDataTable");
      assert.equal(detail.props.children.props.rows[0].tradeId, 1);
      assert.equal(pages.at(-1).range.start, "");
      assert.equal(pages.at(-1).range.end, "");
    } finally { app.close(); }
  });
}

test("backtest analytics starts without files and detail tables do not require overview dates", async () => {
  const queries = [], registrations = [];
  const database = {
    async register(name) { registrations.push(name); },
    async rows(sql) {
      queries.push(sql);
      if (sql.startsWith("DESCRIBE")) return [{ column_name: "tradeDate" }];
      if (sql.includes("count(*)")) return [{ total: 1 }];
      return [{ tradeDate: "2026-01-05" }];
    }
  };
  const { BacktestAnalytics } = load("../src/assets/lib/backtestAnalysis.ts", {
    "@/assets/lib/duckdb": { BrowserDuckDb: { create: async (files) => { assert.deepEqual(Object.keys(files), []); return database; } }, duckDbDateValue: String },
    "@/assets/lib/parquetColumnStats": { readParquetNumericColumnStats: async () => ({}) },
    "@/assets/lib/backtestTable": { backtestTableConfigs: { daily_positions: { tradeDate: {} } } }
  });
  const session = await BacktestAnalytics.create(7);
  assert.equal(session.isRegistered("daily_portfolios"), false);
  assert.equal(queries.length, 0);
  await session.register("daily_positions", new ArrayBuffer(0));
  const page = await session.tablePage("daily_positions", 1, 20, { start: "", end: "" });
  assert.equal(page.total, 1);
  assert.deepEqual(registrations, ["backtest-7-daily_positions.parquet"]);
  assert.ok(queries.every((sql) => !sql.includes("daily_portfolios")));
  assert.doesNotMatch(queries.at(-1), /WHERE|BETWEEN|DATE ''/);
  await session.tablePage("daily_positions", 1, 20, { start: "2026-01-05", end: "2026-01-06" });
  assert.match(queries.at(-1), /BETWEEN DATE '2026-01-05' AND DATE '2026-01-06'/);
});

test("backtest tab changes keep the loaded portfolio and selected range without recalculating the overview", async () => {
  const calls = [], registrations = new Set();
  let summaries = 0;
  const session = {
    isRegistered: (name) => registrations.has(name),
    async register(name) { registrations.add(name); },
    async portfolios() { summaries++; return [{ time: "2026-01-05", dailyReturn: 0.01 }]; },
    async tablePage() { return { columns: [], rows: [], numericStats: {}, total: 0 }; },
    async close() {}
  };
  const api = { async output(_id, name) { calls.push(name); return new ArrayBuffer(0); } };
  const app = reportFixture("../src/components/panel/BacktestReport.tsx", {
    "@/assets/lib/reports": { useReportApi: () => api },
    "@/assets/lib/backtestAnalysis": { BacktestAnalytics: { create: async () => session }, backtestTableTimeColumns: {} },
    "@/assets/lib/backtestTable": { backtestTableConfigs: {} },
    "@/assets/lib/quantstats": { quantStatsReport: () => ({}) },
    "@/types/table": { emptyParquetTableQuery: () => ({ filters: [], sorting: [] }) }
  }, { activeTab: "overview", annualTradingDays: 252, riskFreeRate: 0, workflowInstanceId: 7 });
  try {
    await app.settle();
    assert.equal(app.nodes("DateRangeBar").length, 1);
    app.nodes("DateRangeBar")[0].props.onRangeChange("2026-01-06", "2026-01-07");
    await app.settle();
    app.update({ activeTab: "daily_positions" }); await app.settle();
    app.update({ activeTab: "overview" }); await app.settle();
    assert.equal(app.nodes("DateRangeBar")[0].props.startDate, "2026-01-06");
    assert.equal(app.nodes("DateRangeBar")[0].props.endDate, "2026-01-07");
    assert.equal(summaries, 1);
    assert.deepEqual(calls, ["daily_portfolios", "daily_positions"]);
  } finally { app.close(); }
});

test("daily return metric formulas stay unchanged for new labels including later lags", () => {
  const rows = [{ time: "2026-01-05", value: 0.01, cumulative: 0.01 }, { time: "2026-01-06", value: -0.005, cumulative: 0.00495 }];
  const expected = panel.returnMetrics(rows, 1);
  for (const spec of Object.values(parameters().return_specs)) {
    assert.deepEqual(panel.returnMetrics(rows, spec.periods), expected);
  }
  const annualReturn = (1.00495 ** (252 / 2) - 1);
  const annualVolatility = 0.0075 * Math.sqrt(252);
  assert.equal(expected.find((metric) => metric.label === "多空年化收益").value, `${(annualReturn * 100).toFixed(2)}%`);
  assert.equal(expected.find((metric) => metric.label === "多空年化 Sharpe").value, (annualReturn / annualVolatility).toFixed(4));
  assert.equal(panel.returnMetrics(rows, 2).find((metric) => metric.label === "多空年化收益").value, "—");
});

function longShortRows(values) {
  let netValue = 1;
  return values.map((value, index) => {
    if (value !== null) netValue *= 1 + value;
    return { time: `2026-01-${String(index + 5).padStart(2, "0")}`, value, cumulative: value === null ? null : netValue - 1 };
  });
}

for (const [gap, values] of [
  ["leading", [null, 0.1, 0.1]],
  ["intermediate", [0.1, null, 0.1]],
  ["trailing", [0.1, 0.1, null]],
  ["multiple trailing", [0.1, 0.1, null, null]],
  ["combined", [null, 0.1, null, 0.1, null]]
]) {
  test(`single-period summaries skip ${gap} NULLs without filling curve gaps`, () => {
    const rows = longShortRows(values);
    const cumulative = rows.map((row) => row.cumulative);
    const metrics = panel.returnMetrics(rows, 1);
    assert.deepEqual(metrics, panel.returnMetrics(longShortRows([0.1, 0.1]), 1));
    assert.equal(metrics.find((metric) => metric.label === "多空累计收益").value, "21.00%");
    assert.equal(metrics.find((metric) => metric.label === "多空年化收益").value, `${(((1.1 * 1.1) ** (252 / 2) - 1) * 100).toFixed(2)}%`);
    assert.equal(metrics.find((metric) => metric.label === "多空最大回撤").value, "0.00%");
    assert.equal(panel.maxDrawdown(rows), 0);
    const option = panel.longShortOption(rows, "light", true);
    assert.deepEqual(Array.from(option.series[0].data), values);
    assert.deepEqual(Array.from(option.series[1].data), cumulative);
  });
}

for (const [name, values] of [["empty", []], ["all NULL", [null, null]]]) {
  test(`${name} return data has no summary metrics or drawdown`, () => {
    const rows = longShortRows(values);
    assert.equal(panel.maxDrawdown(rows), null);
    assert.ok(panel.returnMetrics(rows, 1).every((metric) => metric.value === "—"));
    const option = panel.longShortOption(rows, "light", true);
    assert.deepEqual(Array.from(option.series[0].data), values);
    assert.deepEqual(Array.from(option.series[1].data), values);
  });
}

test("nonconstant returns retain annualized Sharpe and real drawdowns across NULL gaps", () => {
  const expected = panel.returnMetrics(longShortRows([0.01, -0.005]), 1);
  const annualReturn = (1.01 * 0.995) ** (252 / 2) - 1;
  const annualVolatility = 0.0075 * Math.sqrt(252);
  const sharpe = (annualReturn / annualVolatility).toFixed(4);
  assert.notEqual(sharpe, "—");
  for (const values of [[null, 0.01, -0.005], [0.01, null, -0.005], [0.01, -0.005, null], [null, 0.01, null, -0.005, null, null]]) {
    const rows = longShortRows(values);
    const metrics = panel.returnMetrics(rows, 1);
    assert.equal(metrics.find((metric) => metric.label === "多空年化 Sharpe").value, sharpe);
    assert.deepEqual(metrics, expected);
    assert.ok(Math.abs(panel.maxDrawdown(rows) - 0.005) < 1e-12);
  }
  assert.ok(Math.abs(panel.maxDrawdown(longShortRows([null, -0.1, null, 0.1, null])) - 0.1) < 1e-12, "drawdown still starts from the initial net value of one");
});

test("zero cumulative return is a valid observation before trailing NULLs", () => {
  const rows = longShortRows([0, null]);
  const metrics = panel.returnMetrics(rows, 1);
  assert.equal(metrics.find((metric) => metric.label === "多空累计收益").value, "0.00%");
  assert.equal(metrics.find((metric) => metric.label === "多空年化收益").value, "0.00%");
  assert.equal(panel.maxDrawdown(rows), 0);
});

for (const periods of [2, 5]) {
  test(`${periods}-period overlapping returns remain noncompoundable with NULL gaps`, () => {
    const values = [null, 0.01, null, -0.005, null];
    const rows = longShortRows(values);
    const metrics = panel.returnMetrics(rows, periods);
    for (const label of ["多空累计收益", "多空年化收益", "多空年化 Sharpe", "多空最大回撤", "多空年化波动"]) {
      assert.equal(metrics.find((metric) => metric.label === label).value, "—");
    }
    assert.equal(metrics.find((metric) => metric.label === "多空单期收益均值").value, "0.25%");
    assert.equal(metrics.find((metric) => metric.label === "多空单期收益标准差").value, "1.06%");
    const option = panel.longShortOption(rows, "light", false);
    assert.equal(option.series.length, 1);
    assert.deepEqual(Array.from(option.series[0].data), values);
  });
}
