import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const realCreate = require("zustand").create;
const storePath = fileURLToPath(new URL("../src/store/strategy.ts", import.meta.url));
const compiledStore = ts.transpileModule(readFileSync(storePath, "utf8"), {
  fileName: storePath,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const path = fileURLToPath(new URL("../src/views/StrategyPage.tsx", import.meta.url));
const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const body = ts.createPrinter().printFile(ts.factory.updateSourceFile(source,
  source.statements.filter((statement) => !ts.isImportDeclaration(statement))));
const compiled = ts.transpileModule(`${body}\nexport { StrategyDetail };`, {
  fileName: path,
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 }
}).outputText;

function deferred() {
  let resolve, reject;
  const promise = new Promise((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

function record(overrides = {}) {
  return {
    id: "strategy", name: "strategy", status: "success", error: "", reportPath: "strategy/output",
    schemeVersion: "1.0.1", workflowId: 7,
    components: Object.fromEntries(["model", "optimize", "control", "execution"].map((stage) => [stage, { label: stage }])),
    ...overrides
  };
}

// The hook harness exercises the actual store and Zustand subscriptions, including
// request/state transitions, but not React reconciliation, StrictMode, or report rendering.
function fixture(cached = record()) {
  const slots = [];
  const metadata = [];
  const lists = [];
  const reports = [];
  const timers = [];
  const updatesAfterClose = [];
  let cursor = 0, queued = false, effects = [], tree, closed = false;
  const context = {
    exports: {}, AbortController, Error,
    React: { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) },
    useState(initial) {
      const slot = slots[cursor++] ??= { value: initial };
      return [slot.value, (update) => {
        if (closed) { updatesAfterClose.push(update); return; }
        const value = typeof update === "function" ? update(slot.value) : update;
        if (!Object.is(value, slot.value)) { slot.value = value; schedule(); }
      }];
    },
    useEffect(callback, deps) {
      const slot = slots[cursor++] ??= {};
      if (!slot.deps || deps.some((value, index) => !Object.is(value, slot.deps[index]))) {
        slot.deps = deps;
        effects.push({ callback, slot });
      }
    },
    client: { get(url) {
      const request = deferred();
      if (url === "/strategies") lists.push(request);
      else {
        assert.equal(url, "/strategies/strategy");
        metadata.push(request);
      }
      return request.promise;
    } },
    loadReportPath: (path, kind, version, signal) => {
      const request = { ...deferred(), path, kind, version, signal };
      reports.push(request);
      return request.promise;
    },
    strategyActive: (status) => ["building", "queued", "running"].includes(status),
    strategyStages: ["model", "optimize", "control", "execution"],
    strategyStatus: { success: "回测成功", running: "运行中", failed: "失败" },
    kindLabels: {}, pageContainer: "page",
    setTimeout(callback, delay) { const timer = { callback, delay, cleared: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cleared = true; }
  };
  const storeModule = { exports: {} };
  vm.runInNewContext(compiledStore, {
    module: storeModule, exports: storeModule.exports, Error,
    require(name) {
      if (name === "react") return { useEffect: context.useEffect };
      if (name === "@/assets/lib/request") return { client: context.client };
      if (name === "@/types/strategy") return { strategyActive: context.strategyActive };
      if (name === "zustand") return { create: realCreate };
      throw new Error(`Unexpected strategy store dependency: ${name}`);
    }
  }, { filename: storePath });
  const store = storeModule.exports.useStrategyStore;
  if (cached) store.getState().upsert(cached);
  context.useStrategyStore = Object.assign((selector) => {
    const slot = slots[cursor++] ??= {};
    slot.selector = selector;
    slot.value = selector(store.getState());
    slot.cleanup ??= store.subscribe((state) => {
      const value = slot.selector(state);
      if (!Object.is(value, slot.value)) { slot.value = value; schedule(); }
    });
    return slot.value;
  }, store);
  for (const name of ["PageHeader", "ReportSkeleton", "ResearchReport", "Alert", "AlertDescription", "Badge", "Button", "ChevronRight", "LoaderCircle"])
    context[name] = Object.defineProperty(() => null, "name", { value: name });
  vm.createContext(context);
  vm.runInContext(compiled, context, { filename: path });
  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; if (!closed) render(); });
  }
  function render() {
    cursor = 0; effects = [];
    tree = context.exports.StrategyDetail({ id: "strategy" });
    for (const { callback, slot } of effects) { slot.cleanup?.(); slot.cleanup = callback(); }
  }
  function elements(value, name) {
    if (Array.isArray(value)) return value.flatMap((item) => elements(item, name));
    if (!value || typeof value !== "object") return [];
    const matches = value.type?.name === name ? [value] : [];
    return [...matches, ...elements(value.children, name)];
  }
  function text(value) {
    if (Array.isArray(value)) return value.map(text).join(" ");
    if (typeof value === "string" || typeof value === "number") return String(value);
    return value && typeof value === "object" ? text(value.children) : "";
  }
  render();
  return {
    metadata, lists, reports, timers, store, updatesAfterClose,
    elements: (name) => elements(tree, name), text: () => text(tree),
    button: (label) => elements(tree, "Button").find((element) => text(element) === label),
    settle: async () => { for (let index = 0; index < 5; index++) await new Promise(setImmediate); },
    close() { closed = true; slots.forEach((slot) => slot.cleanup?.()); }
  };
}

const reportData = { kind: "backtest", files: {}, schemeVersion: "1.0.1" };

test("cached success preserves an early report error after metadata succeeds", async () => {
  const app = fixture();
  try {
    app.reports[0].reject(new Error("报告清单读取失败 (404)"));
    await app.settle();
    app.metadata[0].resolve(record());
    await app.settle();
    assert.match(app.text(), /报告清单读取失败 \(404\)/);
    assert.equal(app.elements("ReportSkeleton").length, 0);
    assert.equal(app.reports.length, 1);
    assert.equal(app.elements("Button").length, 1);
  } finally { app.close(); }
});

test("report failure remains visible when metadata finishes first", async () => {
  const app = fixture();
  try {
    app.metadata[0].resolve(record());
    await app.settle();
    app.reports[0].reject(new Error("network unavailable"));
    await app.settle();
    assert.match(app.text(), /network unavailable/);
    assert.equal(app.elements("ReportSkeleton").length, 0);
  } finally { app.close(); }
});

test("retrying the same report clears its error and renders the successful report", async () => {
  const app = fixture();
  try {
    app.metadata[0].resolve(record());
    app.reports[0].reject(new Error("temporary report failure"));
    await app.settle();
    app.elements("Button")[0].props.onClick();
    await app.settle();
    assert.doesNotMatch(app.text(), /temporary report failure/);
    assert.equal(app.elements("ReportSkeleton").length, 1);
    assert.equal(app.reports.length, 2);
    assert.equal(app.reports[0].signal.aborted, true);
    app.reports[1].resolve(reportData);
    await app.settle();
    assert.equal(app.elements("ResearchReport").length, 1);
    assert.equal(app.elements("ReportSkeleton").length, 0);
  } finally { app.close(); }
});

test("metadata failure cannot hide a successfully loaded cached report", async () => {
  const app = fixture();
  try {
    app.metadata[0].reject(new Error("metadata unavailable"));
    app.reports[0].resolve(reportData);
    await app.settle();
    assert.match(app.text(), /metadata unavailable/);
    assert.equal(app.elements("ResearchReport").length, 1);
  } finally { app.close(); }
});

test("uncached success starts its report after metadata is available", async () => {
  const app = fixture(null);
  try {
    assert.equal(app.reports.length, 0);
    app.metadata[0].resolve(record());
    await app.settle();
    assert.equal(app.reports.length, 1);
    app.reports[0].resolve(reportData);
    await app.settle();
    assert.equal(app.elements("ResearchReport").length, 1);
  } finally { app.close(); }
});

test("a stale report result is ignored after its path changes", async () => {
  const app = fixture();
  try {
    app.metadata[0].resolve(record({ reportPath: "strategy/new-output" }));
    await app.settle();
    assert.equal(app.reports.length, 2);
    assert.equal(app.reports[0].signal.aborted, true);
    app.reports[0].resolve(reportData);
    await app.settle();
    assert.equal(app.elements("ResearchReport").length, 0);
    app.reports[1].resolve(reportData);
    await app.settle();
    assert.equal(app.elements("ResearchReport").length, 1);
  } finally { app.close(); }
});

test("a stale report result is ignored after its scheme version changes via the shared list", async () => {
  const app = fixture();
  try {
    const pendingList = app.store.getState().load();
    const refreshed = record({ schemeVersion: "1.0.2" });
    app.lists[0].resolve([refreshed]);
    await pendingList;
    await app.settle();
    assert.equal(app.store.getState().records[0], refreshed);
    assert.equal(app.reports.length, 2);
    assert.equal(app.reports[0].signal.aborted, true);
    assert.equal(app.reports[1].path, "strategy/output");
    assert.equal(app.reports[1].version, "1.0.2");
    app.reports[0].resolve(reportData);
    await app.settle();
    assert.equal(app.elements("ResearchReport").length, 0);
    const refreshedReport = { ...reportData, schemeVersion: "1.0.2" };
    app.reports[1].resolve(refreshedReport);
    await app.settle();
    assert.equal(app.elements("ResearchReport")[0].props.report, refreshedReport);
  } finally { app.close(); }
});

test("a same-run stale active snapshot cannot hide a terminal cached report", async () => {
  for (const status of ["building", "queued", "running"]) {
    const cached = record();
    const app = fixture(cached);
    try {
      app.reports[0].resolve(reportData);
      await app.settle();
      assert.equal(app.elements("ResearchReport").length, 1);
      app.metadata[0].resolve(record({ status, reportPath: null }));
      await app.settle();
      assert.equal(app.store.getState().records[0], cached);
      assert.equal(app.elements("ResearchReport").length, 1);
      assert.equal(app.elements("PageHeader")[0].props.status.props["data-status"], "success");
      assert.equal(app.reports.length, 1);
      assert.equal(app.reports[0].signal.aborted, false);
      assert.equal(app.timers.length, 0);
    } finally { app.close(); }
  }
});

for (const status of ["success", "failed"]) {
  for (const order of ["list first", "detail first"]) {
    test(`list ${status} and stale running detail reconcile with ${order}`, async () => {
      const app = fixture(record({ status: "running", reportPath: null }));
      try {
        const pendingList = app.store.getState().load();
        const terminal = record({ status, reportPath: status === "success" ? "strategy/output" : null, error: status === "failed" ? "run failed" : "" });
        let queuedPoll;
        if (order === "detail first") {
          app.metadata[0].resolve(record({ status: "running", reportPath: null }));
          await app.settle();
          assert.equal(app.timers.length, 1);
          queuedPoll = app.timers[0];
          assert.equal(app.reports.length, 0);
        }
        app.lists[0].resolve([terminal]);
        await pendingList;
        await app.settle();
        assert.equal(app.store.getState().records[0], terminal);
        assert.equal(app.elements("PageHeader")[0].props.status.props["data-status"], status);
        if (status === "success") {
          assert.equal(app.reports.length, 1);
          app.reports[0].resolve(reportData);
          await app.settle();
          assert.equal(app.elements("ResearchReport").length, 1);
        } else {
          assert.match(app.text(), /run failed/);
          assert.equal(app.reports.length, 0);
          assert.equal(app.elements("ReportSkeleton").length, 0);
        }
        if (order === "list first") {
          app.metadata[0].resolve(record({ status: "running", reportPath: null }));
          await app.settle();
          assert.equal(app.timers.length, 0);
        } else {
          assert.equal(queuedPoll.cleared, true);
          // Even a callback already queued before the terminal list arrived must stop.
          queuedPoll.callback();
          await app.settle();
          assert.equal(app.timers.length, 1);
        }
        assert.equal(app.metadata.length, 1);
        assert.equal(app.store.getState().records[0], terminal);
        assert.equal(app.elements("PageHeader")[0].props.status.props["data-status"], status);
        assert.doesNotMatch(app.text(), /完成后自动显示回测报告/);
        if (status === "success") {
          assert.equal(app.elements("ResearchReport").length, 1);
          assert.equal(app.reports.length, 1);
          assert.equal(app.reports[0].signal.aborted, false);
        } else {
          assert.match(app.text(), /run failed/);
          assert.equal(app.reports.length, 0);
        }
      } finally { app.close(); }
    });
  }
}

test("terminal list updates stop an in-flight detail poll without hiding the report on late success or failure", async () => {
  for (const outcome of ["success", "failure"]) {
    const app = fixture(record({ status: "running", reportPath: null }));
    try {
      app.metadata[0].resolve(record({ status: "running", reportPath: null }));
      await app.settle();
      app.timers[0].callback();
      assert.equal(app.metadata.length, 2);
      const pendingList = app.store.getState().load();
      const terminal = record();
      app.lists[0].resolve([terminal]);
      await pendingList;
      await app.settle();
      app.reports[0].resolve(reportData);
      await app.settle();
      if (outcome === "success") app.metadata[1].resolve(record({ status: "running", reportPath: null }));
      else app.metadata[1].reject(new Error("late metadata failure"));
      await app.settle();
      assert.equal(app.store.getState().records[0], terminal);
      assert.equal(app.elements("ResearchReport").length, 1);
      assert.equal(app.reports.length, 1);
      assert.equal(app.reports[0].signal.aborted, false);
      assert.equal(app.timers.length, 1);
      assert.equal(app.timers[0].cleared, true);
      app.timers[0].callback();
      await app.settle();
      assert.equal(app.metadata.length, 2);
      if (outcome === "failure") {
        assert.match(app.text(), /late metadata failure/);
        assert.ok(app.button("重试详情"));
        app.button("重试详情").props.onClick();
        await app.settle();
        assert.equal(app.metadata.length, 3);
        app.metadata[2].resolve(record({ status: "running", reportPath: null }));
        await app.settle();
        assert.equal(app.button("重试详情"), undefined);
        assert.equal(app.elements("ResearchReport").length, 1);
        assert.equal(app.timers.length, 1);
      }
    } finally { app.close(); }
  }
});

test("metadata retry recovers an initial failure and stops polling at either terminal status", async () => {
  for (const status of ["success", "failed"]) {
    const app = fixture(null);
    try {
      app.metadata[0].reject(new Error("metadata unavailable"));
      await app.settle();
      assert.match(app.text(), /metadata unavailable/);
      assert.equal(app.timers.length, 0);
      assert.ok(app.button("重试详情"));
      app.button("重试详情").props.onClick();
      await app.settle();
      assert.doesNotMatch(app.text(), /metadata unavailable/);
      assert.equal(app.button("重试详情"), undefined);
      assert.equal(app.metadata.length, 2);
      const result = record({ status, reportPath: status === "success" ? "strategy/output" : null, error: status === "failed" ? "strategy failed" : "" });
      app.metadata[1].resolve(result);
      await app.settle();
      assert.equal(app.store.getState().records[0], result);
      assert.equal(app.timers.length, 0);
      assert.equal(app.button("重试详情"), undefined);
      if (status === "success") {
        assert.equal(app.reports.length, 1);
        app.reports[0].resolve(reportData);
        await app.settle();
        assert.equal(app.elements("ResearchReport").length, 1);
      } else {
        assert.match(app.text(), /strategy failed/);
        assert.equal(app.reports.length, 0);
      }
    } finally { app.close(); }
  }
});

test("metadata retry resumes serial polling after a failed poll", async () => {
  const app = fixture(record({ status: "running", reportPath: null }));
  try {
    app.metadata[0].resolve(record({ status: "running", reportPath: null }));
    await app.settle();
    assert.equal(app.timers.length, 1);
    assert.equal(app.timers[0].delay, 5000);
    app.timers[0].callback();
    assert.equal(app.metadata.length, 2);
    app.metadata[1].reject(new Error("poll unavailable"));
    await app.settle();
    assert.ok(app.button("重试详情"));
    app.button("重试详情").props.onClick();
    await app.settle();
    assert.equal(app.metadata.length, 3);
    assert.equal(app.timers[0].cleared, true);
    assert.equal(app.timers.length, 1);
    app.metadata[2].resolve(record({ status: "running", reportPath: null }));
    await app.settle();
    assert.equal(app.timers.length, 2);
    assert.equal(app.timers[1].delay, 5000);
    assert.equal(app.button("重试详情"), undefined);
    assert.doesNotMatch(app.text(), /poll unavailable/);
  } finally { app.close(); }
});

test("metadata retry preserves an independent failure of the same report", async () => {
  const app = fixture();
  try {
    app.metadata[0].reject(new Error("metadata unavailable"));
    app.reports[0].reject(new Error("manifest unavailable"));
    await app.settle();
    assert.ok(app.button("重试详情"));
    assert.ok(app.button("重试报告"));
    app.button("重试详情").props.onClick();
    await app.settle();
    assert.doesNotMatch(app.text(), /metadata unavailable/);
    assert.match(app.text(), /manifest unavailable/);
    assert.equal(app.reports.length, 1);
    app.metadata[1].resolve(record());
    await app.settle();
    assert.equal(app.button("重试详情"), undefined);
    assert.ok(app.button("重试报告"));
    assert.match(app.text(), /manifest unavailable/);
    assert.equal(app.reports.length, 1);
  } finally { app.close(); }
});

test("unmount ignores a pending metadata retry without updating cache or scheduling polling", async () => {
  for (const outcome of ["success", "failure"]) {
    const cached = record({ status: "running", reportPath: null });
    const app = fixture(cached);
    try {
      app.metadata[0].reject(new Error("metadata unavailable"));
      await app.settle();
      assert.ok(app.button("重试详情"));
      app.button("重试详情").props.onClick();
      await app.settle();
      assert.equal(app.metadata.length, 2);
      app.close();
      if (outcome === "success") app.metadata[1].resolve(record({ status: "running", reportPath: null }));
      else app.metadata[1].reject(new Error("late metadata failure"));
      await app.settle();
      assert.equal(app.store.getState().records[0], cached);
      assert.equal(app.timers.length, 0);
      assert.equal(app.reports.length, 0);
      assert.equal(app.updatesAfterClose.length, 0);
    } finally { app.close(); }
  }
});

test("unmount blocks a metadata poll callback already queued before cleanup", async () => {
  const app = fixture(record({ status: "running", reportPath: null }));
  try {
    app.metadata[0].resolve(record({ status: "running", reportPath: null }));
    await app.settle();
    assert.equal(app.timers.length, 1);
    const timer = app.timers[0];
    app.close();
    assert.equal(timer.cleared, true);
    timer.callback();
    await app.settle();
    assert.equal(app.metadata.length, 1);
    assert.equal(app.timers.length, 1);
    assert.equal(app.updatesAfterClose.length, 0);
  } finally { app.close(); }
});

test("unmount aborts an in-flight manifest and ignores late report and metadata results", async () => {
  for (const outcome of ["success", "failure"]) {
    const cached = record();
    const app = fixture(cached);
    try {
      assert.equal(app.reports.length, 1);
      const manifest = app.reports[0];
      assert.equal(manifest.path, cached.reportPath);
      assert.equal(manifest.signal.aborted, false);
      app.close();
      assert.equal(manifest.signal.aborted, true);
      app.metadata[0].resolve(record({ status: "running", reportPath: null }));
      if (outcome === "success") manifest.resolve(reportData);
      else manifest.reject(new Error("late manifest failure"));
      await app.settle();
      assert.equal(app.store.getState().records[0], cached);
      assert.equal(app.reports.length, 1);
      assert.equal(app.timers.length, 0);
      assert.equal(app.elements("ResearchReport").length, 0);
      assert.equal(app.updatesAfterClose.length, 0);
    } finally { app.close(); }
  }
});
