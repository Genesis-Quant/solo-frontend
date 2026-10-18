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

// Compile the real analytics/JSX with isolated sources; SQL tests execute on DuckDB WASM.
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

const { laggedReturns, priceReturns } = load("../src/assets/lib/factorReturns.ts");
function parameters(maxLag = 3) {
  return { factor_columns: ["momentum_7"], ...laggedReturns(maxLag), n_groups: 2, n_select: 10 };
}
function priceParameters(period = 5, maxLag = 3) {
  return { factor_columns: ["factor_a", "factor_b"], ...priceReturns(period, "open_hfq", maxLag), n_groups: 2, n_select: 10 };
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

test("current log labels reach SQL verbatim, stay independent, and keep all decay positions", async () => {
  const input = priceParameters(1);
  const { session, queries } = await analyticsFixture(input);
  assert.equal(queries.length, 0, "creating analytics does not compute unused whole-report summaries");
  for (const factor of input.factor_columns) for (const column of input.return_columns) {
    await session.informationSeries(factor, column);
    assert.ok(queries.at(-1).includes(`"${factor}_${column}_ic"`));
    assert.ok(queries.at(-1).includes(`"${factor}_${column}_rank_ic"`));
    await session.longShortSeries(factor, column);
    assert.ok(queries.at(-1).includes(`"${factor}_${column}_top" - "${factor}_${column}_bottom"`));
    assert.match(queries.at(-1), /sum\(value\) OVER/);
    assert.doesNotMatch(queries.at(-1), /exp\(|product\(/);
    await session.groupSeries(factor, column, input.n_groups);
    assert.ok(queries.at(-1).includes(`"${factor}_${column}_group0" AS raw_1`));
    assert.match(queries.at(-1), /exp\(sum\(value_1\) OVER/);
    assert.doesNotMatch(queries.at(-1), /ln\(|product\(/);
    for (const other of input.return_columns.filter((other) => other !== column)) assert.ok(!queries.at(-1).includes(`_${other}_`));
  }
  const decay = await session.decay(input.factor_columns[0], input.return_columns);
  assert.deepEqual(Array.from(decay, (point) => point.label), Array.from(input.return_columns));
  assert.deepEqual(Array.from(decay, (point) => point.position), [0, 1, 2]);
});

test("all three return queries use metadata ROWS windows before date filtering", async () => {
  const input = { factor_columns: ["momentum_7"], return_columns: ["P999L30", "custom_1", "r3"],
    return_specs: { P999L30: { kind: "log", periods: 2 }, custom_1: { kind: "log", periods: 5 }, r3: { kind: "simple", periods: 1 } },
    n_groups: 2, n_select: 10 };
  const { session, queries } = await analyticsFixture(input);
  for (const column of input.return_columns) {
    const spec = input.return_specs[column];
    for (const method of ["longShortSeries", "groupSeries", "groupStatistics"]) {
      const range = { start: "2026-01-06", end: "2026-01-07" };
      await session[method]("momentum_7", column, ...(method === "longShortSeries" ? [range] : [2, range]));
      const sql = queries.at(-1);
      assert.ok(sql.includes(`ROWS BETWEEN ${spec.periods - 1} PRECEDING AND CURRENT ROW`));
      assert.match(sql, /CASE WHEN count\(raw_0\) OVER .* = count\(\*\) OVER .* THEN avg\(raw_0\) OVER/);
      assert.ok(sql.indexOf("FROM raw_returns") < sql.indexOf("BETWEEN DATE '2026-01-06' AND DATE '2026-01-07'"));
      assert.equal(sql.includes("ln(1 +"), spec.kind === "simple");
      assert.doesNotMatch(sql, /NULL::DOUBLE AS|COALESCE|product\(/i);
      if (method === "groupStatistics") assert.match(sql, /count\(value_1\).*avg\(value_1\).*stddev_samp\(value_1\)/);
    }
  }
});

const tradingDates = [
  "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09",
  "2026-01-12", "2026-01-13", "2026-01-14", "2026-01-15", "2026-01-16",
  "2026-01-19", "2026-01-20", "2026-01-21", "2026-01-22", "2026-01-23",
  "2026-01-26", "2026-01-27", "2026-01-28", "2026-01-29", "2026-01-30"
];
const groupLabels = ["最小 10 支", "Group 1", "Group 2", "最大 10 支"];
const rawLogReturns = [
  [-0.02, 0.01, -0.03, 0.04], [0.04, -0.05, 0.02, -0.01],
  [0.01, 0.03, 0.04, 0.02], [-0.03, 0.02, -0.01, 0.05],
  [0.02, -0.04, 0.06, -0.02], [0.05, 0.01, -0.03, 0.03],
  [null, null, null, null], [-0.02, 0.03, -0.02, 0.06],
  [0.01, -0.01, 0.02, -0.04], [0.03, 0.02, null, 0.01],
  [-0.01, 0.06, 0.04, 0.02], [0.04, -0.03, 0.01, -0.02],
  [0.02, 0.05, -0.04, 0.03], [-0.02, 0.01, 0.03, 0.01],
  [0.03, -0.02, 0.02, 0.05], [0.01, 0.04, 0.05, -0.03],
  [-0.03, 0.03, -0.01, 0.02], [0.02, -0.01, 0.04, 0.06],
  [null, null, null, null], [null, null, null, null]
];

async function duckDbFixture(input) {
  const duckdb = require("@duckdb/duckdb-wasm/blocking");
  const modulePath = (variant) => fileURLToPath(new URL(`../node_modules/@duckdb/duckdb-wasm/dist/duckdb-${variant}.wasm`, import.meta.url));
  const db = await duckdb.createDuckDB({ mvp: { mainModule: modulePath("mvp") }, eh: { mainModule: modulePath("eh") } }, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
  await db.instantiate();
  const connection = db.connect();
  const raw = {}, queries = [], columns = [], informationColumns = [];
  try {
    connection.query("SET autoinstall_known_extensions = false");
    connection.query("SET autoload_known_extensions = false");
    for (const [factorIndex, factor] of input.factor_columns.entries()) for (const column of input.return_columns) {
      const spec = input.return_specs[column];
      const lag = spec.lag ?? 1;
      raw[`${factor}_${column}`] = rawLogReturns.map((row, index) => row.map((value, group) => {
        if (value === null || lag === 3 && index === 0 && group === 1 || lag === 2 && index === 2 && group === 0) return null;
        return value * (1 + (lag - 1) / 2) + (lag - 1) * (group % 2 ? -0.009 : 0.007) + factorIndex * 0.002 * group;
      }));
      for (const [group, suffix] of ["bottom", "group0", "group1", "top"].entries()) columns.push({
        name: `${factor}_${column}_${suffix}`,
        values: raw[`${factor}_${column}`].map((row) => row[group] === null ? null : spec.kind === "simple" ? Math.expm1(row[group]) : row[group])
      });
      informationColumns.push(`${factor}_${column}_ic`, `${factor}_${column}_rank_ic`);
    }
    connection.query(`CREATE TABLE returns (time DATE, ${columns.map(({ name }) => `"${name}" DOUBLE`).join(", ")})`);
    connection.query(`INSERT INTO returns VALUES ${tradingDates.map((time, index) => `('${time}', ${columns.map(({ values }) => values[index] === null ? "NULL" : values[index]).join(", ")})`).join(", ")}`);
    connection.query(`CREATE TABLE information (time DATE, ${informationColumns.map((column) => `"${column}" DOUBLE`).join(", ")})`);
    connection.query(`INSERT INTO information VALUES ${tradingDates.map((time, index) => `('${time}', ${informationColumns.map((_column, columnIndex) => index === 6 ? "NULL" : (columnIndex + 1) / 100).join(", ")})`).join(", ")}`);
    const { FactorAnalytics } = load("../src/assets/lib/factorAnalysis.ts", {
      "@/assets/lib/duckdb": { BrowserDuckDb: { create: async () => ({
        async rows(sql) {
          queries.push(sql);
          return connection.query(sql.replaceAll("read_parquet('factor-7-groups.parquet')", "returns").replaceAll("read_parquet('factor-7-information.parquet')", "information")).toArray().map((row) => row.toJSON());
        },
        async close() {}
      }) }, duckDbDateValue: (value) => new Date(Number(value)).toISOString().slice(0, 10) }
    });
    const session = await FactorAnalytics.create(7, { information: new ArrayBuffer(0), groups: new ArrayBuffer(0) }, input);
    return { session, raw, queries, close() { connection.close(); db.reset(); } };
  } catch (reason) { connection.close(); db.reset(); throw reason; }
}

function effectiveValues(values, periods) {
  return values.map((_value, index) => {
    const window = values.slice(Math.max(0, index - periods + 1), index + 1);
    return window.includes(null) ? null : window.reduce((sum, value) => sum + value, 0) / window.length;
  });
}
function cumulativeValues(values, reverse = false, nav = false) {
  let sum = 0;
  const result = values.map(() => null);
  const indices = values.map((_value, index) => index);
  if (reverse) indices.reverse();
  for (const index of indices) if (values[index] !== null) {
    sum += values[index];
    result[index] = nav ? Math.exp(sum) : sum;
  }
  return result;
}
function close(actual, expected) {
  if (expected === null) assert.equal(actual, null);
  else assert.ok(typeof actual === "number" && Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
}
function closeValues(actual, expected) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => close(value, expected[index]));
}
function checkGroupStatistics(statistics, effective) {
  const studentTCdf = require("@stdlib/stats-base-dists-t-cdf");
  for (const [group, label] of groupLabels.entries()) {
    const row = statistics.find((row) => row.group === label);
    const values = effective[group].filter((value) => value !== null);
    const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    close(row.mean, mean);
    if (values.length < 3) assert.equal(row.pValue, null);
    else {
      const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
      const statistic = deviation > 0 ? Math.abs(mean / (deviation / Math.sqrt(values.length))) : null;
      close(row.pValue, statistic === null ? null : 2 * (1 - studentTCdf(statistic, values.length - 1)));
    }
  }
}

for (const period of [1, 2, 5]) {
  test(`DuckDB P${period} log returns use expanding trading-row windows, strict NULLs and the same forward/reverse effective series`, async () => {
    const input = priceParameters(period);
    const fixture = await duckDbFixture(input);
    try {
      for (const factor of input.factor_columns) for (const column of input.return_columns) {
        const raw = fixture.raw[`${factor}_${column}`];
        const spread = raw.map((row) => row[0] === null || row[3] === null ? null : row[3] - row[0]);
        const effective = effectiveValues(spread, period);
        const longShort = await fixture.session.longShortSeries(factor, column);
        assert.deepEqual(Array.from(longShort, (row) => row.time), tradingDates, "full trading calendar includes all-NULL dates without weekend rows");
        closeValues(Array.from(longShort, (row) => row.value), effective);
        closeValues(Array.from(longShort, (row) => row.cumulative), cumulativeValues(effective));
        assert.ok(longShort.some((row) => row.value < 0), "negative log spreads are not exponentiated or clipped");
        assert.equal(longShort[6].value, null);
        for (let index = 6; index < 6 + period; index++) assert.equal(longShort[index].value, null, "one NULL invalidates every window containing its trading row");
        const groups = await fixture.session.groupSeries(factor, column, input.n_groups);
        assert.deepEqual(Array.from(groups, (row) => row.time), tradingDates);
        const groupEffective = groupLabels.map((_label, group) => effectiveValues(raw.map((row) => row[group]), period));
        for (const [group, label] of groupLabels.entries()) {
          closeValues(Array.from(groups, (row) => row.values[label]), cumulativeValues(groupEffective[group], false, true));
          closeValues(Array.from(groups, (row) => row.reverseValues[label]), cumulativeValues(groupEffective[group], true, true));
          assert.equal(groups.at(-1).values[label], null, "trailing NULL is a gap, not a repeated NAV");
          if (input.return_specs[column].lag === 3 && group === 1) {
            for (let index = 0; index < period; index++) assert.equal(groups[index].values[label], null, "leading NULLs cannot be compressed out of the window");
          }
        }
        checkGroupStatistics(await fixture.session.groupStatistics(factor, column, input.n_groups), groupEffective);
      }
      const first = await fixture.session.longShortSeries("factor_a", `P${period}L1`);
      close(first[0].value, 0.06);
      close(first[1].value, period === 1 ? -0.05 : 0.005);
      if (period === 5) {
        close(first[2].value, 0.02 / 3);
        close(first[5].value, -0.02 / 5);
      }
      assert.notEqual(first[0].value, (await fixture.session.longShortSeries("factor_a", `P${period}L3`))[0].value, "selected lags never average together");
    } finally { fixture.close(); }
  });

  test(`DuckDB P${period} date selection preserves full-report window context and only resets cumulative origins`, async () => {
    const input = priceParameters(period, 1);
    const fixture = await duckDbFixture(input);
    try {
      const factor = input.factor_columns[0], column = input.return_columns[0];
      const raw = fixture.raw[`${factor}_${column}`];
      const effective = effectiveValues(raw.map((row) => row[3] === null || row[0] === null ? null : row[3] - row[0]), period);
      const full = await fixture.session.longShortSeries(factor, column);
      const fullGroups = await fixture.session.groupSeries(factor, column, input.n_groups);
      for (const [start, end] of [[1, 5], [5, 8], [8, 17], [13, 17], [18, 19], [0, 1]]) {
        const range = { start: tradingDates[start], end: tradingDates[end] };
        const rows = await fixture.session.longShortSeries(factor, column, range);
        assert.deepEqual(Array.from(rows, (row) => row.time), tradingDates.slice(start, end + 1));
        closeValues(Array.from(rows, (row) => row.value), Array.from(full.slice(start, end + 1), (row) => row.value));
        closeValues(Array.from(rows, (row) => row.cumulative), cumulativeValues(effective.slice(start, end + 1)));
        const groups = await fixture.session.groupSeries(factor, column, input.n_groups, range);
        const groupEffective = groupLabels.map((_label, group) => effectiveValues(raw.map((row) => row[group]), period).slice(start, end + 1));
        for (const [group, label] of groupLabels.entries()) {
          closeValues(Array.from(groups, (row) => row.values[label]), cumulativeValues(groupEffective[group], false, true));
          closeValues(Array.from(groups, (row) => row.reverseValues[label]), cumulativeValues(groupEffective[group], true, true));
          for (let index = start; index <= end; index++) if (fullGroups[index].values[label] === null) assert.equal(groups[index - start].values[label], null);
        }
        checkGroupStatistics(await fixture.session.groupStatistics(factor, column, input.n_groups, range), groupEffective);
      }
      const empty = { start: "2026-02-01", end: "2026-02-02" };
      assert.equal((await fixture.session.longShortSeries(factor, column, empty)).length, 0);
      assert.equal((await fixture.session.groupSeries(factor, column, input.n_groups, empty)).length, 0);
      checkGroupStatistics(await fixture.session.groupStatistics(factor, column, input.n_groups, empty), groupLabels.map(() => []));
    } finally { fixture.close(); }
  });
}

test("DuckDB simple metadata normalizes each source with ln(1+source) before the same P2 spread/window/statistics flow", async () => {
  const input = { factor_columns: ["factor_a"], return_columns: ["custom_99"], return_specs: { custom_99: { kind: "simple", periods: 2 } }, n_groups: 2, n_select: 10 };
  const fixture = await duckDbFixture(input);
  try {
    const raw = fixture.raw.factor_a_custom_99;
    const effective = effectiveValues(raw.map((row) => row[0] === null || row[3] === null ? null : row[3] - row[0]), 2);
    const rows = await fixture.session.longShortSeries("factor_a", "custom_99");
    closeValues(Array.from(rows, (row) => row.value), effective);
    closeValues(Array.from(rows, (row) => row.cumulative), cumulativeValues(effective));
    const groups = await fixture.session.groupSeries("factor_a", "custom_99", 2);
    const groupEffective = groupLabels.map((_label, group) => effectiveValues(raw.map((row) => row[group]), 2));
    for (const [group, label] of groupLabels.entries()) {
      closeValues(Array.from(groups, (row) => row.values[label]), cumulativeValues(groupEffective[group], false, true));
      closeValues(Array.from(groups, (row) => row.reverseValues[label]), cumulativeValues(groupEffective[group], true, true));
    }
    checkGroupStatistics(await fixture.session.groupStatistics("factor_a", "custom_99", 2), groupEffective);
  } finally { fixture.close(); }
});

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
}, "\nexport { LaggedReturnNotice, ReturnContract, returnMetrics, maxDrawdown, longShortOption, groupChartPoints, informationMetrics, informationOption, decaySummary, decayOption, ReportSelect };");
function text(Component, props) {
  return renderToStaticMarkup(React.createElement(Component, props)).replace(/<[^>]+>/g, "");
}

test("N=2 report notice explains four log segments over three trading days without changing the annual model", () => {
  const notice = text(panel.LaggedReturnNotice, { specs: parameters(2).return_specs });
  assert.match(notice, /N=2.*t 至 t\+2.*3 个交易日（N\+1）.*4 个单段对数收益/);
  assert.match(notice, /r\{k-1\}o 为隔夜 C_adj\(t\+k-1\) → O_adj\(t\+k\)/);
  assert.match(notice, /r\{k\} 为日内 O_adj\(t\+k\) → C_adj\(t\+k\)/);
  assert.match(notice, /ln\(终价 \/ 初价\)/);
  assert.match(notice, /periods=1.*每个交易日一条观测.*252 个交易日/);
  assert.match(notice, /换手比较间隔独立于收益时段/);
  assert.doesNotMatch(notice, /简单收益|不可复利|重叠/);
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
    assert.match(contract, /对数收益.*1 期/);
    assert.doesNotMatch(contract, /简单收益|可复利|重叠/);
  }
  const legacy = text(panel.ReturnContract, { spec: { kind: "simple", periods: 2 } });
  assert.match(legacy, /对数收益2 期/);
  assert.doesNotMatch(legacy, /隔夜|日内|C_adj|O_adj|简单收益|可复利|重叠/);
});

test("new price contracts explain exact entry and exit trading days without the historical segment notice", () => {
  for (const [price, label] of [["open", "开盘价"], ["close", "收盘价"], ["open_hfq", "后复权开盘价"], ["close_hfq", "后复权收盘价"]]) {
    const specs = priceReturns(5, price, 3).return_specs;
    assert.equal(text(panel.LaggedReturnNotice, { specs }), "");
    for (let lag = 1; lag <= 3; lag++) {
      const contract = text(panel.ReturnContract, { spec: specs[`P5L${lag}`] });
      assert.ok(contract.includes(`${label} t+${lag} → t+${lag + 5}`));
      assert.ok(contract.includes(`入场滞后 ${lag} 个交易日`));
      assert.match(contract, /对数收益.*跨度 5 个交易日/);
      assert.doesNotMatch(contract, /隔夜|日内|N=|重叠|可复利|不能连续复利/);
    }
  }
});

test("IC summaries and selected decay ignore NULL samples and never mix IC with RankIC", () => {
  const information = [{ time: "a", ic: null, rankIc: 0.5 }, { time: "b", ic: 0.2, rankIc: null }, { time: "c", ic: 0.4, rankIc: 0.1 }];
  assert.equal(panel.informationMetrics(information, "IC")[0].value, "0.3000");
  assert.equal(panel.informationMetrics(information, "RankIC")[0].value, "0.3000");
  assert.ok(panel.informationMetrics([{ time: "a", ic: null, rankIc: null }], "IC").every((metric) => metric.value === "—"));
  const decay = [{ label: "a", returnColumn: "a", position: 0, icMean: 0.6, rankIcMean: 0.1 }, { label: "b", returnColumn: "b", position: 1, icMean: 0.2, rankIcMean: 0.5 }, { label: "c", returnColumn: "c", position: 2, icMean: null, rankIcMean: 0.2 }];
  assert.deepEqual(Array.from(panel.decaySummary(decay, "IC"), (metric) => metric.value), ["a", "0.6000", "b"]);
  assert.deepEqual(Array.from(panel.decaySummary(decay, "RankIC"), (metric) => metric.value), ["b", "0.5000", "c"]);
  assert.ok(panel.decaySummary([{ label: "a", returnColumn: "a", position: 0, icMean: null, rankIcMean: null }], "RankIC").every((metric) => metric.value === "—"));
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
    "@/assets/lib/chart": { thresholdMarkLine: () => ({}), chartRange: (values) => { const finite = values.filter((value) => value !== null && Number.isFinite(value)); return finite.length ? { min: Math.min(...finite), max: Math.max(...finite) } : undefined; } }, "@/assets/lib/utils": { errorMessage: (reason) => reason.message },
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

function syntheticReport(input = priceParameters()) {
  const calls = [], downloads = [], created = [], closed = [];
  const dates = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"];
  const pickDates = (range) => dates.filter((time) => !range || time >= range.start && time <= range.end);
  function session(parameters) {
    const check = (name, factor, column, range) => {
      assert.ok(parameters.factor_columns.includes(factor), `unknown factor ${factor}`);
      if (column) assert.ok(parameters.return_columns.includes(column), `unknown return ${column}`);
      calls.push({ name, factor, column, range });
    };
    return {
      async informationSeries(factor, column, range) {
        check("information", factor, column, range);
        const value = parameters.factor_columns.indexOf(factor) + parameters.return_columns.indexOf(column) / 10;
        return pickDates(range).map((time, index) => ({ time, ic: index === 1 ? null : value + 0.1, rankIc: index === 1 ? null : value + 0.3, icCumulative: index === 1 ? null : value + 0.2, rankIcCumulative: index === 1 ? null : value + 0.6 }));
      },
      async longShortSeries(factor, column, range) { check("returns", factor, column, range); return pickDates(range).map((time, index) => ({ time, value: 0.01, cumulative: 0.01 * (index + 1) })); },
      async groupSeries(factor, column, _groups, range) { check("groups", factor, column, range); const selected = pickDates(range); return selected.map((time, index) => ({ time, values: { "Group 1": Math.exp(0.01 * (index + 1)) }, reverseValues: { "Group 1": Math.exp(0.01 * (selected.length - index)) } })); },
      async groupStatistics(factor, column, _groups, range) { check("groupStatistics", factor, column, range); return [{ group: "Group 1", mean: 0.01, pValue: null }]; },
      async decay(factor, columns, range) { check("decay", factor, undefined, range); return columns.map((returnColumn, position) => ({ returnColumn, label: returnColumn, position, icMean: [0.6, 0.3, null][position] ?? null, rankIcMean: [0.1, 0.4, null][position] ?? null })); },
      async turnoverPeriods(factor) { check("periods", factor); return [1, 2, 5, 7]; },
      async turnoverSummary(factor, periods, _groups, range) { check("turnover", factor, undefined, range); calls.at(-1).periods = periods; return { periods, rankAutocorrelation: 0.5, groups: [{ group: "Group 1", value: 0.2 }] }; },
      async executionStatistics(range) { calls.push({ name: "execution", range }); return pickDates(range).map((time) => ({ time, sourceCount: 10, filteredCount: 8, filters: [] })); },
      async close() { closed.push(parameters); }
    };
  }
  const api = { async outputs() { return ["information_coefficient", "group_returns", "group_turnover", "execution_statistics"].map((name) => ({ name })); }, async output(_id, name) { downloads.push(name); return new ArrayBuffer(0); } };
  const app = reportFixture("../src/components/panel/FactorAnalysisReport.tsx", {
    "@/assets/lib/reports": { useReportApi: () => api },
    "@/assets/lib/factorAnalysis": { FactorAnalytics: { create: async (_id, _files, parameters) => { created.push(parameters); return session(parameters); } } }
  }, { parameters: input, workflowInstanceId: 7 });
  return { app, calls, downloads, created, closed,
    choose: (label, value) => app.nodes("ReportSelect").find((node) => node.props.label === label).props.onChange(value),
    selected: () => Object.fromEntries(app.nodes("ReportSelect").map((node) => [node.props.label, node.props.value]))
  };
}

test("three report selectors sit under dates, use accessible Radix selects, and share all applicable dimensions", async () => {
  const fixture = syntheticReport();
  const { app, calls, choose } = fixture;
  try {
    await app.settle();
    assert.deepEqual(fixture.selected(), { 因子: "factor_a", 收益率: "P5L1", "IC 类型": "RankIC" });
    const controls = app.tree.props.children.find((node) => node?.props?.["aria-label"] === "报告筛选");
    assert.match(controls.props.className, /grid-cols-1.*sm:grid-cols-3/);
    assert.equal(app.tree.props.children.indexOf(controls), 1, "controls follow the date range directly");
    assert.equal(app.nodes("ReturnSelector").length + app.nodes("Segmented").length, 0);
    for (const selector of app.nodes("ReportSelect")) {
      const tree = panel.ReportSelect(selector.props);
      assert.equal(reportElements(tree, "SelectTrigger")[0].props["aria-label"], selector.props.label);
      assert.equal(reportElements(tree, "Select").length, 1);
      assert.ok(reportElements(tree, "SelectItem").every((option) => !["all", "全部"].includes(option.props.value)));
    }
    app.nodes("DateRangeBar")[0].props.onRangeChange("2026-01-06", "2026-01-07"); await app.settle();
    const executionCount = calls.filter((call) => call.name === "execution").length;
    choose("因子", "factor_b"); await app.settle();
    choose("收益率", "P5L3"); await app.settle();
    choose("IC 类型", "IC"); await app.settle();
    assert.equal(app.nodes("DateRangeBar")[0].props.startDate, "2026-01-06");
    assert.equal(app.nodes("DateRangeBar")[0].props.endDate, "2026-01-07");
    assert.equal(fixture.created.length, 1);
    assert.equal(fixture.downloads.length, 4, "dimension changes reuse the session and downloaded Parquet");
    assert.equal(calls.filter((call) => call.name === "execution").length, executionCount, "DSL statistics only depend on dates");
    for (const name of ["information", "returns", "groups", "groupStatistics"]) {
      const call = calls.filter((call) => call.name === name).at(-1);
      assert.equal(call.factor, "factor_b"); assert.equal(call.column, "P5L3");
      assert.equal(call.range.start, "2026-01-06"); assert.equal(call.range.end, "2026-01-07");
    }
    assert.equal(calls.filter((call) => call.name === "turnover").at(-1).periods, 5, "P5L3 maps turnover to period 5, not lag 3");
    assert.equal(calls.filter((call) => call.name === "turnover").at(-1).factor, "factor_b");
    const information = reportElements(app.card("information"), "EChart")[0].props.option;
    assert.equal(information.series[0].name, "IC");
    assert.equal(app.nodes("DateRangeBar")[0].props.points[0].value, 1.3, "date preview follows factor/return/IC");
    const decay = reportElements(app.card("decay"), "EChart")[0].props.option;
    assert.equal(decay.series.length, 1); assert.equal(decay.series[0].name, "IC 均值");
    assert.deepEqual(Array.from(decay.xAxis.data), ["P5L1", "P5L2", "P5L3"]);
    assert.deepEqual(Array.from(decay.series[0].data, (point) => point.value), [0.6, 0.3, null]);
    assert.deepEqual(Array.from(decay.series[0].data, (point) => point.itemStyle.opacity), [0.4, 0.4, 1]);
    assert.equal(reportElements(app.card("decay"), "SummaryTiles")[0].props.items[0].value, "P5L1");
    assert.equal(reportElements(app.card("groups"), "EChart").length, 2);
    assert.equal(reportElements(app.card("returns"), "EChart")[0].props.option.series.length, 2);
    assert.equal(reportElements(app.card("returns"), "EChart")[0].props.option.series[1].name, "累计对数收益");
    const metrics = reportElements(app.card("returns"), "MetricGrid")[0].props.items;
    assert.equal(metrics.length, 7);
    assert.equal(metrics.find((metric) => metric.label === "多空累计对数收益").value, "2.00%");
    assert.equal(metrics.find((metric) => metric.label === "多空年化对数收益").value, "252.00%");
    const groupQueries = calls.filter((call) => call.name === "groups").length;
    const tabs = reportElements(app.card("groups"), "TabsTrigger");
    assert.equal(tabs.length, 2);
    assert.ok(tabs.every((tab) => tab.props.disabled !== true), "P5 forward/reverse tabs remain enabled");
    reportElements(app.card("groups"), "Tabs")[0].props.onValueChange("reverse"); await app.settle();
    const reverse = reportElements(app.card("groups"), "EChart")[0].props.option;
    assert.deepEqual(Array.from(reverse.xAxis.data), ["2026-01-07（起点）", "2026-01-07", "2026-01-06"]);
    closeValues(Array.from(reverse.series[0].data), [1, Math.exp(0.01), Math.exp(0.02)]);
    assert.equal(calls.filter((call) => call.name === "groups").length, groupQueries, "reverse reorders the same effective results rather than querying a reverse window");
    const source = readFileSync(new URL("../src/components/panel/FactorAnalysisReport.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(source, /重叠|不可复利|不能连续复利|净值曲线不生成|compoundable|OverlappingReturnNotice|NonCompoundableChartState/);
  } finally { app.close(); }
});

test("P5 component hooks render DuckDB effective log metrics and NAVs through dates, lag/factor selects and reverse tabs", async () => {
  const input = priceParameters(5);
  const fixture = await duckDbFixture(input);
  const downloads = [];
  const api = {
    async outputs() { return ["information_coefficient", "group_returns"].map((name) => ({ name })); },
    async output(_id, name) { downloads.push(name); return new ArrayBuffer(0); }
  };
  const app = reportFixture("../src/components/panel/FactorAnalysisReport.tsx", {
    "@/assets/lib/reports": { useReportApi: () => api },
    "@/assets/lib/factorAnalysis": { FactorAnalytics: { create: async () => fixture.session } }
  }, { parameters: input, workflowInstanceId: 7 });
  const choose = (label, value) => app.nodes("ReportSelect").find((node) => node.props.label === label).props.onChange(value);
  function verify(factor, column, start, end, reverse = false) {
    const raw = fixture.raw[`${factor}_${column}`];
    const values = effectiveValues(raw.map((row) => row[0] === null || row[3] === null ? null : row[3] - row[0]), 5).slice(start, end + 1);
    const cumulative = cumulativeValues(values);
    const option = reportElements(app.card("returns"), "EChart")[0].props.option;
    closeValues(Array.from(option.series[0].data), values);
    closeValues(Array.from(option.series[1].data), cumulative);
    assert.equal(option.series[1].name, "累计对数收益");
    const expectedRows = values.map((value, index) => ({ time: tradingDates[start + index], value, cumulative: cumulative[index] }));
    assert.deepEqual(Array.from(reportElements(app.card("returns"), "MetricGrid")[0].props.items, (metric) => [metric.label, metric.value]), Array.from(panel.returnMetrics(expectedRows), (metric) => [metric.label, metric.value]));
    const groupCharts = reportElements(app.card("groups"), "EChart");
    assert.equal(groupCharts.length, 2);
    const nav = groupCharts[0].props.option;
    for (const [group, label] of groupLabels.entries()) {
      const effective = effectiveValues(raw.map((row) => row[group]), 5).slice(start, end + 1);
      const cumulative = cumulativeValues(effective, reverse, true);
      const expected = reverse ? [1, ...cumulative.reverse()] : cumulative;
      closeValues(Array.from(nav.series.find((series) => series.name === label).data), expected);
      const valid = effective.filter((value) => value !== null);
      close(groupCharts[1].props.option.series[0].data[group], valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null);
    }
    assert.equal(app.nodes("ReportSelect").length, 3);
    assert.ok(reportElements(app.card("groups"), "TabsTrigger").every((tab) => tab.props.disabled !== true));
  }
  try {
    await app.settle();
    verify("factor_a", "P5L1", 0, 19);
    const fullValues = Array.from(reportElements(app.card("returns"), "EChart")[0].props.option.series[0].data);
    app.nodes("DateRangeBar")[0].props.onRangeChange(tradingDates[8], tradingDates[17]); await app.settle();
    verify("factor_a", "P5L1", 8, 17);
    assert.deepEqual(Array.from(reportElements(app.card("returns"), "EChart")[0].props.option.series[0].data), fullValues.slice(8, 18), "date zoom does not change effective values or NULL windows");
    choose("收益率", "P5L3"); await app.settle(); verify("factor_a", "P5L3", 8, 17);
    choose("因子", "factor_b"); await app.settle(); verify("factor_b", "P5L3", 8, 17);
    choose("IC 类型", "IC"); await app.settle(); verify("factor_b", "P5L3", 8, 17);
    const queryCount = fixture.queries.length;
    reportElements(app.card("groups"), "Tabs")[0].props.onValueChange("reverse"); await app.settle();
    verify("factor_b", "P5L3", 8, 17, true);
    assert.equal(fixture.queries.length, queryCount, "reverse never re-windows or refetches raw returns");
    app.nodes("DateRangeBar")[0].props.onReset(); await app.settle();
    verify("factor_b", "P5L3", 0, 19, true);
    assert.deepEqual(downloads, ["information_coefficient", "group_returns"]);
  } finally { app.close(); fixture.close(); }
});

test("a new report scope resets selectors and dates before querying, while same-value polling preserves them", async () => {
  const { app, calls, choose, selected, created, closed } = syntheticReport();
  try {
    await app.settle();
    choose("因子", "factor_b"); await app.settle(); choose("收益率", "P5L3"); await app.settle(); choose("IC 类型", "IC"); await app.settle();
    app.nodes("DateRangeBar")[0].props.onRangeChange("2026-01-06", "2026-01-07"); await app.settle();
    app.update({ parameters: JSON.parse(JSON.stringify(priceParameters())) }); await app.settle();
    assert.deepEqual(selected(), { 因子: "factor_b", 收益率: "P5L3", "IC 类型": "IC" });
    assert.equal(created.length, 1);
    const next = { ...priceParameters(1, 2), factor_columns: ["new_factor", "other_factor"] };
    const boundary = calls.length;
    app.update({ parameters: next }); await app.settle();
    assert.deepEqual(selected(), { 因子: "new_factor", 收益率: "P1L1", "IC 类型": "RankIC" });
    assert.equal(created.length, 2); assert.equal(closed.length, 1);
    assert.equal(app.nodes("DateRangeBar")[0].props.startDate, "2026-01-05");
    assert.equal(app.nodes("DateRangeBar")[0].props.endDate, "2026-01-08");
    assert.ok(calls.slice(boundary).filter((call) => call.factor).every((call) => call.factor === "new_factor"));
    assert.ok(calls.slice(boundary).filter((call) => call.column).every((call) => call.column === "P1L1"));
    assert.equal(reportElements(app.card("groups"), "EChart").length, 2);
    assert.equal(reportElements(app.card("groups"), "TabsTrigger").length, 2, "orthogonal group ordering remains available");
  } finally { app.close(); }
});

test("historical return metadata drives turnover mapping and missing actual periods never silently fall back", async () => {
  const input = { factor_columns: ["legacy"], return_columns: ["r1", "r2", "custom_99", "return_3"],
    return_specs: { ...laggedReturns(2).return_specs, custom_99: { kind: "log", periods: 1, turnover_period: 7 }, return_3: { kind: "simple", periods: 3 } }, n_groups: 2, n_select: 10 };
  const { app, calls, choose } = syntheticReport(input);
  try {
    await app.settle();
    assert.equal(calls.filter((call) => call.name === "turnover").at(-1).periods, 1);
    choose("收益率", "r2"); await app.settle();
    assert.equal(calls.filter((call) => call.name === "turnover").at(-1).periods, 2);
    choose("收益率", "custom_99"); await app.settle();
    assert.equal(calls.filter((call) => call.name === "turnover").at(-1).periods, 7);
    const count = calls.filter((call) => call.name === "turnover").length;
    choose("收益率", "return_3"); await app.settle();
    assert.equal(calls.filter((call) => call.name === "turnover").length, count);
    assert.equal(reportElements(app.card("turnover"), "EChart").length, 0);
    assert.equal(reportElements(app.card("turnover"), "SeriesContent")[0].props.count, 0);
  } finally { app.close(); }
});

test("stale factor/return queries are cancelled and late sessions close without overwriting a new report", async () => {
  const pending = [], closed = [], calls = [];
  let delayed = true;
  const session = {
    informationSeries(factor, column, range) {
      calls.push({ factor, column, range });
      const value = column.endsWith("2") ? 0.9 : 0.1;
      const rows = [{ time: "2026-01-05", ic: value, rankIc: value, icCumulative: value, rankIcCumulative: value }];
      if (range && delayed) return new Promise((resolve) => pending.push({ column, resolve: () => resolve(rows) }));
      return Promise.resolve(rows);
    },
    async longShortSeries() { return []; }, async groupSeries() { return []; }, async groupStatistics() { return []; }, async decay() { return []; },
    async turnoverPeriods() { return []; }, async executionStatistics() { return []; }, async close() { closed.push("session"); }
  };
  const api = { async outputs() { return []; }, async output() { return new ArrayBuffer(0); } };
  const app = reportFixture("../src/components/panel/FactorAnalysisReport.tsx", {
    "@/assets/lib/reports": { useReportApi: () => api },
    "@/assets/lib/factorAnalysis": { FactorAnalytics: { create: async () => session } }
  }, { parameters: priceParameters(1, 2), workflowInstanceId: 7 });
  try {
    await app.settle();
    app.nodes("ReportSelect").find((node) => node.props.label === "收益率").props.onChange("P1L2"); await app.settle();
    pending.find((query) => query.column === "P1L2").resolve(); await app.settle();
    assert.equal(reportElements(app.card("information"), "EChart")[0].props.option.series[0].data[0], 0.9);
    pending.find((query) => query.column === "P1L1").resolve(); await app.settle();
    assert.equal(reportElements(app.card("information"), "EChart")[0].props.option.series[0].data[0], 0.9);
    delayed = false;
  } finally { app.close(); }
  assert.equal(closed.length, 1);

  const creations = [], lateClosed = [];
  const late = reportFixture("../src/components/panel/FactorAnalysisReport.tsx", {
    "@/assets/lib/reports": { useReportApi: () => api },
    "@/assets/lib/factorAnalysis": { FactorAnalytics: { create: () => new Promise((resolve) => creations.push(resolve)) } }
  }, { parameters: priceParameters(), workflowInstanceId: 7 });
  try {
    await late.settle();
    late.update({ workflowInstanceId: 8 }); await late.settle();
    assert.equal(creations.length, 2);
    creations[0]({ async close() { lateClosed.push(7); } }); await late.settle();
    assert.deepEqual(lateClosed, [7]);
    creations[1](session); await late.settle();
    assert.equal(late.nodes("ReportSelect").length, 3);
  } finally { late.close(); }
});

test("ResearchReport removes its outer selector and keeps API identity stable across equivalent polling objects", () => {
  const context = { Provider: "ReportProvider" }, apis = [];
  const input = { kind: "factor", schemeVersion: "1.2.3", files: { group_returns: "/a/groups", information_coefficient: "/a/information" }, parameters: priceParameters(), annualTradingDays: 252, riskFreeRate: 0 };
  const app = reportFixture("../src/components/panel/ResearchReport.tsx", {
    "@/assets/lib/reports": { ReportContext: context, reportApi: (report) => { const api = { report }; apis.push(api); return api; } }
  }, { report: input, workflowId: 7 });
  try {
    const original = app.tree.props.value;
    assert.equal(app.nodes("Select").length, 0);
    app.update({ report: { ...input, files: { information_coefficient: "/a/information", group_returns: "/a/groups" } } });
    assert.equal(app.tree.props.value, original);
    app.update({ report: { ...input, files: { ...input.files, group_returns: "/b/groups" } } });
    assert.notEqual(app.tree.props.value, original);
    assert.equal(apis.length, 2);
  } finally { app.close(); }
});

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

for (const retry of ["factor", "dates", "return"]) {
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
      async turnoverPeriods() { return [1, 2]; },
      turnoverSummary() { return query("turnover", { periods: 1, rankAutocorrelation: 0.5, groups: [{ group: "Group 1", value: 0.2 }] }); },
      executionStatistics() { return query("statistics", [{ time, sourceCount: 10, filteredCount: 8, filters: [] }]); },
      async close() {}
    };
    const api = { async outputs() { return []; }, async output() { return new ArrayBuffer(0); } };
    const app = reportFixture("../src/components/panel/FactorAnalysisReport.tsx", {
      "@/assets/lib/reports": { useReportApi: () => api },
      "@/assets/lib/factorAnalysis": { FactorAnalytics: { create: async () => session } }
    }, { parameters: { ...parameters(2), factor_columns: ["momentum_7", "momentum_8", "momentum_9"] }, workflowInstanceId: 7 });
    const content = (id) => reportElements(app.card(id), "SeriesContent")[0].props;
    const choose = (label, value) => app.nodes("ReportSelect").find((node) => node.props.label === label).props.onChange(value);
    try {
      await app.settle();
      assert.match(content("turnover").error, /turnover failed/);
      assert.match(content("execution-statistics").error, /statistics failed/);
      fail = false;
      choose("因子", "momentum_8");
      app.nodes("DateRangeBar")[0].props.onRangeChange(time, "2026-01-06"); await app.settle();
      assert.equal(content("turnover").error, "");
      assert.equal(content("execution-statistics").error, "");
      assert.equal(reportElements(app.card("turnover"), "EChart").length, 1);
      assert.equal(reportElements(app.card("execution-statistics"), "EChart").length, 1);
      fail = true;
      app.nodes("DateRangeBar")[0].props.onRangeChange(time, "2026-01-07"); await app.settle();
      assert.match(content("turnover").error, /turnover failed/);
      assert.match(content("execution-statistics").error, /statistics failed/);
      fail = false; retryPending = true;
      if (retry === "factor") choose("因子", "momentum_9");
      else if (retry === "dates") app.nodes("DateRangeBar")[0].props.onRangeChange(time, "2026-01-08");
      else choose("收益率", "r2");
      await app.settle();
      assert.equal(content("turnover").error, "", "turnover errors clear before the retry resolves");
      if (retry === "dates") assert.equal(content("execution-statistics").error, "", "statistics errors clear before the date retry resolves");
      else assert.match(content("execution-statistics").error, /statistics failed/, "dimension changes do not requery date-only statistics");
      retryPending = false;
      requests.splice(0).forEach((resolve) => resolve()); await app.settle();
      assert.equal(content("turnover").error, "");
      assert.equal(reportElements(app.card("turnover"), "EChart").length, 1);
      if (retry === "dates") assert.equal(reportElements(app.card("execution-statistics"), "EChart").length, 1);
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

test("effective log summaries keep log sums, arithmetic annualization and existing population/sample DDOF conventions", () => {
  const rows = longShortRows([0.01, -0.005]);
  const metrics = panel.returnMetrics(rows);
  const annualReturn = 0.005 * 252 / 2;
  const annualVolatility = 0.0075 * Math.sqrt(252);
  assert.equal(metrics.find((metric) => metric.label === "多空累计对数收益").value, "0.50%");
  assert.equal(metrics.find((metric) => metric.label === "多空年化对数收益").value, `${(annualReturn * 100).toFixed(2)}%`);
  assert.equal(metrics.find((metric) => metric.label === "多空年化对数波动").value, `${(annualVolatility * 100).toFixed(2)}%`);
  assert.equal(metrics.find((metric) => metric.label === "多空年化 Sharpe").value, (annualReturn / annualVolatility).toFixed(4));
  assert.equal(metrics.find((metric) => metric.label === "多空单期对数收益均值").value, "0.25%");
  assert.equal(metrics.find((metric) => metric.label === "多空单期对数收益标准差").value, `${(Math.SQRT2 * 0.0075 * 100).toFixed(2)}%`);
});

function longShortRows(values) {
  const cumulative = cumulativeValues(values);
  return values.map((value, index) => ({ time: `2026-01-${String(index + 5).padStart(2, "0")}`, value, cumulative: cumulative[index] }));
}

for (const [gap, values] of [
  ["leading", [null, 0.1, 0.1]],
  ["intermediate", [0.1, null, 0.1]],
  ["trailing", [0.1, 0.1, null]],
  ["multiple trailing", [0.1, 0.1, null, null]],
  ["combined", [null, 0.1, null, 0.1, null]]
]) {
  test(`log summaries skip ${gap} NULLs without filling curve gaps or changing observation counts`, () => {
    const rows = longShortRows(values);
    const cumulative = rows.map((row) => row.cumulative);
    const metrics = panel.returnMetrics(rows);
    assert.deepEqual(metrics, panel.returnMetrics(longShortRows([0.1, 0.1])));
    assert.equal(metrics.find((metric) => metric.label === "多空累计对数收益").value, "20.00%");
    assert.equal(metrics.find((metric) => metric.label === "多空年化对数收益").value, "2520.00%");
    assert.equal(metrics.find((metric) => metric.label === "多空最大回撤").value, "0.00%");
    assert.equal(panel.maxDrawdown(rows), 0);
    const option = panel.longShortOption(rows, "light");
    assert.equal(option.series[1].name, "累计对数收益");
    assert.deepEqual(Array.from(option.series[0].data), values);
    assert.deepEqual(Array.from(option.series[1].data), cumulative);
  });
}

for (const [name, values] of [["empty", []], ["all NULL", [null, null]]]) {
  test(`${name} return data has no summary metrics or drawdown`, () => {
    const rows = longShortRows(values);
    assert.equal(panel.maxDrawdown(rows), null);
    assert.ok(panel.returnMetrics(rows).every((metric) => metric.value === "—"));
    const option = panel.longShortOption(rows, "light");
    assert.equal(option.series.length, 2);
    assert.deepEqual(Array.from(option.series[0].data), values);
    assert.deepEqual(Array.from(option.series[1].data), values);
  });
}

test("nonconstant log returns retain annualized Sharpe and exponential NAV drawdowns across NULL gaps", () => {
  const expected = panel.returnMetrics(longShortRows([0.01, -0.005]));
  const annualReturn = 0.005 * 252 / 2;
  const annualVolatility = 0.0075 * Math.sqrt(252);
  const sharpe = (annualReturn / annualVolatility).toFixed(4);
  assert.notEqual(sharpe, "—");
  for (const values of [[null, 0.01, -0.005], [0.01, null, -0.005], [0.01, -0.005, null], [null, 0.01, null, -0.005, null, null]]) {
    const rows = longShortRows(values);
    const metrics = panel.returnMetrics(rows);
    assert.equal(metrics.find((metric) => metric.label === "多空年化 Sharpe").value, sharpe);
    assert.deepEqual(metrics, expected);
    close(panel.maxDrawdown(rows), 1 - Math.exp(-0.005));
  }
  close(panel.maxDrawdown(longShortRows([null, -0.1, null, 0.1, null])), 1 - Math.exp(-0.1));
  const negative = panel.returnMetrics(longShortRows([-1.2, null, 0.1]));
  assert.equal(negative.find((metric) => metric.label === "多空累计对数收益").value, "-110.00%", "log cumulative values below -1 remain valid");
  assert.equal(negative.find((metric) => metric.label === "多空年化对数收益").value, "-13860.00%");
  close(panel.maxDrawdown(longShortRows([-1.2, null, 0.1])), 1 - Math.exp(-1.2));
});

test("zero cumulative log return is a valid observation before trailing NULLs", () => {
  const rows = longShortRows([0, null]);
  const metrics = panel.returnMetrics(rows);
  assert.equal(metrics.find((metric) => metric.label === "多空累计对数收益").value, "0.00%");
  assert.equal(metrics.find((metric) => metric.label === "多空年化对数收益").value, "0.00%");
  assert.equal(panel.maxDrawdown(rows), 0);
});

for (const periods of [2, 5]) {
  test(`P${periods} effective values drive complete log metrics and both series without an extra period divisor`, () => {
    const values = effectiveValues([0.08, -0.04, 0.02, 0.06, -0.03, null, 0.01, -0.02, 0.04, 0.03, 0.02], periods);
    const rows = longShortRows(values);
    const metrics = panel.returnMetrics(rows);
    assert.ok(metrics.every((metric) => metric.value !== "—"));
    const valid = values.filter((value) => value !== null);
    const cumulative = valid.reduce((sum, value) => sum + value, 0);
    const mean = cumulative / valid.length;
    const variance = valid.reduce((sum, value) => sum + (value - mean) ** 2, 0);
    assert.equal(metrics.find((metric) => metric.label === "多空累计对数收益").value, `${(cumulative * 100).toFixed(2)}%`);
    assert.equal(metrics.find((metric) => metric.label === "多空年化对数收益").value, `${(mean * 252 * 100).toFixed(2)}%`);
    assert.equal(metrics.find((metric) => metric.label === "多空单期对数收益均值").value, `${(mean * 100).toFixed(2)}%`);
    assert.equal(metrics.find((metric) => metric.label === "多空单期对数收益标准差").value, `${(Math.sqrt(variance / (valid.length - 1)) * 100).toFixed(2)}%`);
    assert.equal(metrics.find((metric) => metric.label === "多空年化对数波动").value, `${(Math.sqrt(variance / valid.length) * Math.sqrt(252) * 100).toFixed(2)}%`);
    const option = panel.longShortOption(rows, "light", { primary: { min: -0.1, max: 0.1 }, secondary: { min: -0.3, max: 0.5 } });
    assert.equal(option.series.length, 2);
    assert.equal(option.yAxis.length, 2);
    assert.equal(option.yAxis[0].min, -0.1); assert.equal(option.yAxis[1].max, 0.5);
    assert.deepEqual(Array.from(option.series[0].data), values);
    assert.deepEqual(Array.from(option.series[1].data), rows.map((row) => row.cumulative));
  });
}
