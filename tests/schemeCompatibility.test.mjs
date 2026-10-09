import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");

function load(relative, overrides = {}, globals = {}) {
  const filename = fileURLToPath(new URL(relative, import.meta.url));
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, ...globals,
    require(name) {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name.startsWith("@/ui/")) return new Proxy({}, { get: (_target, key) => key });
      if (name.startsWith("@/") || name.startsWith(".")) throw new Error(`Unexpected dependency: ${name}`);
      return require(name);
    }
  }, { filename });
  return module.exports;
}

const scheme = load("../src/assets/lib/scheme.ts");

for (const [left, right, expected] of [
  ["1.1.0", "1.1.7", true], ["1.1.7", "1.1.0", true],
  ["v1.1.0", "1.1.7", true], ["1.10.0", "1.10.99", true],
  ["1.1.7", "1.0.7", false], ["1.1.7", "1.2.0", false],
  ["1.1.7", "2.1.7", false], ["1.1.0", "1.10.0", false],
  [null, null, false], [undefined, "1.1.0", false], ["bad", "bad", false]
]) {
  test(`project compatibility ${String(left)} / ${String(right)} = ${expected}`, () => {
    assert.equal(scheme.sameSchemeSeries(left, right), expected);
  });
}

function backtestManifest(version) {
  return {
    protocol: 1, status: "success", versions: { scheme: version }, input: { kind: "strategy" },
    report_kind: "backtest", reports: Object.fromEntries(
      ["daily_portfolios", "trade_details", "daily_positions", "daily_trading_statistics"].map((name) => [name, `${name}.parquet`])
    )
  };
}

const reports = load("../src/assets/lib/reports.ts", { "./scheme": scheme, "./settings": { apiUrl: "/api/v1" } });

for (const version of ["1.0.1", "1.1.0", "1.1.7", "1.2.0", "1.99.9"]) {
  test(`report ${version} still uses the major-1 adapter`, () => {
    assert.equal(scheme.supportsScheme(version), true);
    const report = reports.parseReport(backtestManifest(version), "/reports/example", "strategy");
    assert.equal(report.schemeVersion, version);
    assert.equal(report.kind, "backtest");
    assert.equal(report.files.daily_portfolios, "/reports/example/daily_portfolios.parquet");
  });
}

test("report dispatch rejects unknown major rather than falling back", () => {
  assert.equal(scheme.supportsScheme("2.1.0"), false);
  assert.throws(() => reports.parseReport(backtestManifest("2.1.0"), "/reports/example", "strategy"), /尚不支持/);
});

test("report loading accepts different minors of the requested major", async () => {
  const calls = [];
  const loader = load("../src/assets/lib/reports.ts", { "./scheme": scheme, "./settings": { apiUrl: "/api/v1" } }, {
    fetch: async (url) => {
      calls.push(url);
      return { ok: true, json: async () => backtestManifest("1.2.7") };
    }
  });
  const report = await loader.loadReportPath("example/report", "strategy", "1.0.1");
  assert.equal(report.schemeVersion, "1.2.7");
  assert.deepEqual(calls, ["/api/v1/reports/example/report/run.json"]);
});

function project(kind, id, actual, declared = actual) {
  return {
    id, name: id, kind, schemeVersion: declared,
    versions: [{ id: `${id}-version`, number: 1, status: "success", dependencies: [{ name: "scheme", version: actual }] }]
  };
}

function elements(tree, type) {
  if (Array.isArray(tree)) return tree.flatMap((child) => elements(child, type));
  if (!tree || typeof tree !== "object") return [];
  return [...(tree.type === type ? [tree] : []), ...elements(tree.props?.children, type)];
}

function dialogOptions(modelVersion, downstreamVersions) {
  const projects = [project("model", "model", modelVersion), project("model", "unsupported", "2.1.0"),
    ...downstreamVersions.map((version, index) => project("optimize", `optimize-${index}`, version, "1.0.0"))];
  const artifacts = projects.map((record) => ({ id: `${record.id}-artifact`, kind: record.kind, package: record.id, version: "1.1.1",
    publishedAt: "2026-10-07", schemeVersion: record.versions[0].dependencies[0].version, sourceProjectName: record.name }));
  const state = ["", { artifacts: { model: "model-artifact" } }, null, 0, false, ""];
  let index = 0;
  const { default: StrategyDialog } = load("../src/components/modal/StrategyDialog.tsx", {
    react: { ...require("react"), useState: () => [state[index++], () => { throw new Error("Read-only render"); }] },
    "@/assets/lib/request": { client: {} },
    "@/assets/lib/scheme": scheme,
    "@/hooks/usePublishedArtifacts": { usePublishedArtifacts: () => ({ artifacts, loaded: true, refreshing: false, error: "", reload() {} }) },
    "@/types/research": { kindLabels: {} },
    "@/types/strategy": { strategyStages: ["model", "optimize", "control", "execution"] },
    "@/components/field/SchemaFields": { __esModule: true, default: "SchemaFields" }
  });
  const tree = StrategyDialog({ onClose() {}, onCreated() {} });
  return Object.fromEntries(elements(tree, "Select").map((select) => [
    elements(select, "SelectTrigger")[0].props.id,
    elements(select, "SelectItem").map((item) => item.props.value)
  ]));
}

test("strategy dialog filters by actual Scheme series, allowing newer and older patches", () => {
  const options = dialogOptions("1.1.7", ["1.1.0", "1.1.9", "1.0.7", "1.2.0", "2.1.0", "invalid"]);
  assert.deepEqual(options["strategy-model"], ["model-artifact"]);
  assert.deepEqual(options["strategy-optimize"], ["default", "optimize-0-artifact", "optimize-1-artifact"]);
});

test("older model patch can select a newer downstream patch", () => {
  assert.deepEqual(dialogOptions("1.1.0", ["1.1.7"])["strategy-optimize"], ["default", "optimize-0-artifact"]);
});

test("an invalid selected Scheme version never matches invalid downstream versions", () => {
  assert.deepEqual(dialogOptions("invalid", ["invalid", "1.1.0"])["strategy-optimize"], ["default"]);
});
