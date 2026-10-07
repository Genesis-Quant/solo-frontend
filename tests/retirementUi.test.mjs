import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const stageNames = ["model", "optimize", "control", "execution"];

// Render the real dialog/page JSX without a browser. Portal-based UI primitives,
// passive hooks, stores and requests are isolated; no request can reach an API.
const ui = new Proxy({}, { get(target, name) {
  return target[name] ??= Object.assign((props) => {
    if (props.asChild) return props.children;
    const tag = { Button: "button", Input: "input", Textarea: "textarea", Label: "label", SelectItem: "option" }[name] ?? "div";
    const attributes = Object.fromEntries(Object.entries(props).filter(([key]) =>
      ["id", "className", "title", "disabled", "type", "value", "placeholder", "htmlFor"].includes(key) || key.startsWith("aria-")));
    return React.createElement(tag, { ...attributes, "data-ui": name, ...(["input", "textarea"].includes(tag) ? { readOnly: true } : {}) },
      ...(Array.isArray(props.children) ? props.children : [props.children]));
  }, { displayName: name });
} });

function loader(overrides) {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const extra = filename.endsWith("ProjectPage.tsx") ? "\nexport { ProjectDetail, VersionActions, VersionSummary, ExecutionState };" : "";
    const compiled = ts.transpileModule(readFileSync(filename, "utf8") + extra, {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
    }).outputText;
    vm.runInNewContext(compiled, {
      module, exports: module.exports, AbortController, URLSearchParams,
      require(name) {
        if (Object.hasOwn(overrides, name)) return overrides[name];
        if (name.startsWith("@/ui/")) return ui;
        if (!name.startsWith("@/") && !name.startsWith(".")) return require(name);
        const candidate = name.startsWith("@/") ? join(root, "src", name.slice(2)) : resolve(dirname(filename), name);
        const path = [candidate, `${candidate}.ts`, `${candidate}.tsx`].find(existsSync);
        if (!path) throw new Error(`Unexpected dependency: ${name}`);
        return load(path);
      }
    }, { filename });
    return module.exports;
  }
  return load;
}

function elements(tree, name) {
  if (Array.isArray(tree)) return tree.flatMap((child) => elements(child, name));
  if (!React.isValidElement(tree)) return [];
  return [...(tree.type.displayName === name || tree.type === name ? [tree] : []), ...elements(tree.props.children, name)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  return React.isValidElement(tree) ? text(tree.props.children) : "";
}
function project(id, kind = "model", scheme = "1.2.0", overrides = {}, versionOverrides = {}) {
  return {
    id, name: id, description: "研究说明", kind, schemeVersion: scheme, algoVersion: "v1.2.0", archived: false,
    updatedAt: "2026-10-07T00:00:00Z", ...overrides,
    versions: [{ id: `${id}-version`, number: 1, note: "历史研究", submittedAt: "2026-10-07", status: "success",
      publishStatus: "unpublished", workflowId: 7, duration: "10s", reportPath: `${id}/report`, parameters: {},
      dependencies: [{ name: "scheme", version: scheme }], ...versionOverrides }]
  };
}
const forms = Object.fromEntries(stageNames.map((kind) => [kind, { schema: { properties: {} }, values: {} }]));

function fixture(relative, { projects = [], props = {}, selectedVersion, get, post, report } = {}) {
  const slots = [], requests = [], edits = [], creates = [], publishes = [], selected = [];
  let cursor = 0, effects = [], tree, queued = false, closed = false;
  const state = { projects,
    createProject: async (...args) => { creates.push(args); return "created-project"; },
    editProject: async (...args) => { edits.push(args); },
    publishVersion: (...args) => { publishes.push(args); }
  };
  function schedule() {
    if (queued || closed) return;
    queued = true;
    queueMicrotask(() => { queued = false; if (!closed) render(); });
  }
  const hooks = { ...React,
    useState(initial) {
      const slot = slots[cursor++] ??= { value: typeof initial === "function" ? initial() : initial };
      return [slot.value, (update) => {
        if (closed) return;
        const value = typeof update === "function" ? update(slot.value) : update;
        if (!Object.is(value, slot.value)) { slot.value = value; schedule(); }
      }];
    },
    useEffect(callback, deps) {
      const slot = slots[cursor++] ??= {};
      if (!slot.deps || deps.some((value, index) => !Object.is(value, slot.deps[index]))) {
        slot.deps = deps;
        effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); });
      }
    }
  };
  const overrides = {
    react: hooks,
    "react-router-dom": {
      useNavigate: () => () => {}, useParams: () => ({ projectId: state.projects[0]?.id }),
      useSearchParams: () => [new URLSearchParams(selectedVersion ? { version: selectedVersion } : {}), (params) => selected.push(params.version)],
      Link: ({ to, children }) => React.createElement("a", { href: to }, ...(Array.isArray(children) ? children : [children]))
    },
    "@/assets/lib/settings": { apiUrl: "/api/v1" },
    "./settings": { apiUrl: "/api/v1" },
    "@/assets/lib/request": { client: {
      get(url) { requests.push(["get", url]); assert.ok(get, `Unexpected mock request: ${url}`); return Promise.resolve(get(url)); },
      post(url, body) { requests.push(["post", url, body]); assert.ok(post, `Unexpected mock request: ${url}`); return Promise.resolve(post(url, body)); }
    } },
    "@/store/research": { useResearchStore: (selector) => selector(state) },
    "@/store/pageMemory": { usePageState: (_scope, _key, initial) => hooks.useState(initial), lastPrimaryPage: () => "/models" },
    "@/assets/lib/prototype": { defaultDownstream: Object.fromEntries(["factor", ...stageNames].map((kind) => [kind, []])), stepState: () => "success" },
    "@/components/field/SchemaFields": { __esModule: true, default: () => null },
    "@/components/modal/TaskLogDialog": { __esModule: true, default: () => null },
    "@/components/panel/ReportSkeleton": { __esModule: true, default: () => React.createElement("div", { "data-report": "loading" }) },
    "@/components/panel/ResearchReport": { __esModule: true, default: ({ report, workflowId }) =>
      React.createElement("div", { "data-report": report.schemeVersion, "data-workflow": workflowId }, "历史报告") }
  };
  const load = loader(overrides);
  const reports = load(join(root, "src/assets/lib/reports.ts"));
  overrides["@/assets/lib/reports"] = { ...reports, loadReport: async (version, kind, signal) => {
    requests.push(["report", version.id, kind, signal]);
    assert.ok(report, "The report must come from a local mock, never fetch");
    return report(reports, version, kind);
  } };
  const exports = load(join(root, relative));
  const internals = new Set(Object.values(exports));
  function expand(node) {
    if (Array.isArray(node)) return node.map(expand);
    if (!React.isValidElement(node)) return node;
    if (internals.has(node.type)) return expand(node.type(node.props));
    const children = expand(node.props.children);
    return React.cloneElement(node, {}, ...(Array.isArray(children) ? children : [children]));
  }
  function render() {
    cursor = 0; effects = [];
    tree = expand(exports.default(props));
    effects.splice(0).forEach((effect) => effect());
  }
  render();
  return {
    state, requests, edits, creates, publishes, selected, render,
    elements: (name) => elements(tree, name), text: () => text(tree), html: () => renderToStaticMarkup(tree),
    button: (label) => elements(tree, "Button").find((element) => text(element) === label),
    select: (id) => elements(tree, "Select").find((element) => elements(element, "SelectTrigger").some((trigger) => trigger.props.id === id)),
    options(id) { return elements(this.select(id), "SelectItem").map((item) => item.props.value); },
    submit: () => elements(tree, "form")[0].props.onSubmit({ preventDefault() {} }),
    settle: async () => { for (let index = 0; index < 5; index++) await new Promise(setImmediate); },
    close() { closed = true; slots.forEach((slot) => slot.cleanup?.()); }
  };
}
const strategy = (options) => fixture("src/components/modal/StrategyDialog.tsx", { ...options, props: { onClose() {}, onCreated() {} } });
const detail = (record, options = {}) => fixture("src/views/ProjectPage.tsx", { projects: [record], ...options });
const creation = (get) => fixture("src/components/modal/ProjectDialog.tsx", { get, props: { kind: "model", onClose() {} } });
const schemeRelease = { tag: "v1.2.0", commit: "scheme", version: "1.2.0" };
const algoRelease = { tag: "v1.2.0", commit: "algo" };
function oldReport(reports, _version, kind) {
  return reports.parseReport({ protocol: 1, status: "success", versions: { scheme: "1.0.1" }, input: { kind }, report_kind: "backtest",
    reports: Object.fromEntries(["daily_portfolios", "trade_details", "daily_positions", "daily_trading_statistics"].map((name) => [name, `${name}.parquet`]))
  }, "/historical/report", kind);
}

test("strategy dialog excludes retired projects and versions across every stage, preserving undefined flags", async () => {
  const projects = stageNames.flatMap((kind) => [
    project(`${kind}-active`, kind), project(`${kind}-retired-project`, kind, "1.2.0", { retired: true }),
    project(`${kind}-retired-version`, kind, "1.2.0", {}, { retired: true }), project(`${kind}-archived`, kind, "1.2.0", { archived: true })
  ]);
  const app = strategy({ projects });
  try {
    assert.deepEqual(app.options("strategy-model"), ["model-active-version"]);
    app.select("strategy-model").props.onValueChange("model-active-version");
    await app.settle();
    for (const kind of stageNames.slice(1)) assert.deepEqual(app.options(`strategy-${kind}`), ["default", `${kind}-active-version`]);
    assert.doesNotMatch(app.html(), /retired-project|retired-version|archived/);
    assert.deepEqual(app.requests, []);
  } finally { app.close(); }
});

test("strategy choices never replace missing or invalid saved actual Scheme with a project tag", () => {
  const dependencies = [[], [{ name: "model-other", version: "1.2.0" }], [{ name: "scheme" }], [{ name: "scheme", version: null }], [{ name: "scheme", version: "invalid" }]];
  const app = strategy({ projects: dependencies.map((items, index) => project(`unknown-${index}`, "model", "1.2.0", {}, { dependencies: items })) });
  try {
    assert.deepEqual(app.options("strategy-model"), []);
    assert.equal(app.elements("Button").find((button) => button.props.type === "submit").props.disabled, true);
    assert.match(app.html(), /实际 Scheme 1.x/);
  } finally { app.close(); }
});

test("actual Scheme series wins over declared project tags and permits different patches", async () => {
  const app = strategy({ projects: [
    project("model", "model", "1.0.1", {}, { dependencies: [{ name: "scheme", version: "1.2.7" }] }),
    project("older", "optimize", "1.0.1", {}, { dependencies: [{ name: "scheme", version: "1.2.0" }] }),
    project("newer", "optimize", "1.0.1", {}, { dependencies: [{ name: "scheme", version: "1.2.9" }] }),
    project("wrong-series", "optimize", "1.2.7", {}, { dependencies: [{ name: "scheme", version: "1.0.1" }] })
  ] });
  try {
    app.select("strategy-model").props.onValueChange("model-version");
    await app.settle();
    assert.deepEqual(app.options("strategy-optimize"), ["default", "older-version", "newer-version"]);
    assert.match(app.html(), /Scheme 1.2.7/);
  } finally { app.close(); }
});

test("a model retired after selection cannot request Forms even through a direct submit", async () => {
  const record = project("model");
  const app = strategy({ projects: [record] });
  try {
    app.select("strategy-model").props.onValueChange("model-version");
    await app.settle();
    record.retired = true;
    app.render();
    await app.submit();
    await app.settle();
    assert.equal(app.elements("Button").find((button) => button.props.type === "submit").props.disabled, true);
    assert.match(app.text(), /所选研究版本已退役/);
    assert.deepEqual(app.requests, []);
  } finally { app.close(); }
});

test("retirement after Forms have loaded blocks final strategy creation, not just selection", async () => {
  const downstream = project("optimize", "optimize");
  const app = strategy({ projects: [project("model"), downstream], post(url) { assert.equal(url, "/strategies/forms"); return forms; } });
  try {
    app.select("strategy-model").props.onValueChange("model-version");
    await app.settle();
    app.select("strategy-optimize").props.onValueChange("optimize-version");
    await app.settle();
    for (let step = 0; step < 4; step++) { await app.submit(); await app.settle(); }
    downstream.versions[0].retired = true;
    app.render();
    assert.equal(app.button("创建并回测").props.disabled, true);
    await app.submit();
    await app.settle();
    assert.match(app.text(), /所选研究版本已退役/);
    assert.deepEqual(app.requests.map(([method, url]) => [method, url]), [["post", "/strategies/forms"]]);
  } finally { app.close(); }
});

test("a retired 1.0.1 version keeps its actual historical report, Jupyter, logs and version navigation", async () => {
  const record = project("history", "model", "1.2.0", {}, { retired: true, retiredReason: "Scheme 1.0.1 已退役", dependencies: [{ name: "scheme", version: "1.0.1" }] });
  record.versions.unshift({ ...record.versions[0], id: "current-version", number: 2, retired: false, retiredReason: null });
  const app = detail(record, { selectedVersion: "history-version", report: oldReport });
  try {
    await app.settle();
    const html = app.html();
    assert.match(html, /版本已退役/);
    assert.match(html, /Scheme 1.0.1 已退役/);
    assert.match(html, /data-report="1.0.1"/);
    assert.match(html, /href="\/api\/v1\/projects\/history\/jupyter"/);
    assert.equal(app.button("发布版本").props.disabled, true);
    const history = app.elements("SelectItem").find((item) => item.props.value === "history-version");
    assert.equal(history.props.disabled, undefined);
    assert.match(text(history), /已退役/);
    app.elements("Select")[0].props.onValueChange("current-version");
    assert.deepEqual(app.selected, ["current-version"]);
    assert.equal(app.elements("Button").find((button) => button.props["aria-label"] === "编辑项目").props.disabled, undefined);
    assert.equal(app.elements("Button").find((button) => button.props["aria-label"] === "DolphinScheduler 日志").props.disabled, undefined);
    app.button("发布版本").props.onClick();
    await app.settle();
    assert.equal(app.button("确认发布"), undefined);
    assert.deepEqual(app.publishes, []);
    assert.equal(app.requests[0][1], "history-version");
  } finally { app.close(); }
});

test("project retirement also blocks publication of an otherwise active actual version", async () => {
  const record = project("retired-project", "model", "old-tag", { retired: true, retiredReason: "创建模板已退役" }, { dependencies: [{ name: "scheme", version: "1.2.0" }] });
  const app = detail(record, { report: oldReport });
  try {
    await app.settle();
    assert.match(app.html(), /版本已退役/);
    assert.match(app.html(), /创建模板已退役/);
    assert.match(app.html(), /data-report="1.0.1"/);
    assert.equal(app.button("发布版本").props.disabled, true);
  } finally { app.close(); }
});

test("a retired project without runs shows retirement help rather than encouraging new saves", () => {
  const record = project("empty", "model", "1.0.1", { retired: true, retiredReason: null });
  record.versions = [];
  const app = detail(record);
  try {
    assert.match(app.html(), /版本已退役/);
    assert.match(app.html(), /请使用活跃版本新建项目/);
    assert.doesNotMatch(app.html(), /在 Jupyter 中完成研究后提交版本/);
    assert.deepEqual(app.requests, []);
  } finally { app.close(); }
});

test("records with undefined retirement flags preserve the existing mock publish flow", async () => {
  const record = project("legacy");
  const app = detail(record, { report: oldReport });
  try {
    await app.settle();
    assert.doesNotMatch(app.html(), /版本已退役/);
    assert.equal(app.button("发布版本").props.disabled, false);
    app.button("发布版本").props.onClick();
    await app.settle();
    app.button("确认发布").props.onClick();
    await app.settle();
    assert.deepEqual(app.publishes, [["legacy", "legacy-version"]]);
  } finally { app.close(); }
});

test("retirement removes an already open publish confirmation without rewriting the record", async () => {
  const record = project("confirm");
  const app = detail(record, { report: oldReport });
  try {
    await app.settle();
    app.button("发布版本").props.onClick();
    await app.settle();
    assert.ok(app.button("确认发布"));
    record.versions[0].retired = true;
    record.versions[0].retiredReason = "当前版本已退役";
    app.render();
    assert.equal(app.button("确认发布"), undefined);
    assert.equal(app.button("发布版本").props.disabled, true);
    assert.deepEqual(app.publishes, []);
    assert.equal(record.versions[0].publishStatus, "unpublished");
  } finally { app.close(); }
});

test("published retired history retains its published label and record contents", async () => {
  const record = project("published", "model", "1.0.1", {}, { retired: true, publishStatus: "published" });
  const snapshot = JSON.stringify(record);
  const app = detail(record, { report: oldReport });
  try {
    await app.settle();
    assert.equal(app.button("已发布").props.disabled, true);
    assert.match(app.html(), /data-report="1.0.1"/);
    assert.equal(JSON.stringify(record), snapshot);
  } finally { app.close(); }
});

test("retired metadata editing only annotates description, keeping the original name and records", async () => {
  const record = project("metadata", "model", "1.0.1", { retired: true, retiredReason: "旧模板已退役" });
  const snapshot = JSON.stringify(record);
  const app = fixture("src/components/modal/ProjectDialog.tsx", { projects: [record], props: { kind: "model", project: record, onClose() {} } });
  try {
    assert.equal(app.button("保存修改").props.disabled, false);
    const nameInput = app.elements("Input")[0];
    assert.equal(nameInput.props.disabled, true);
    assert.equal(nameInput.props.value, "metadata");
    assert.equal(app.elements("Textarea")[0].props.disabled, undefined);
    assert.match(app.html(), /仅可修改描述作为历史注释/);
    assert.match(app.html(), /不会重建环境、更改历史记录或恢复版本使用/);
    nameInput.props.onChange({ target: { value: "不允许的重命名" } });
    app.elements("Textarea")[0].props.onChange({ target: { value: "历史用途注释" } });
    await app.settle();
    assert.equal(app.elements("Input")[0].props.value, "metadata");
    await app.submit();
    await app.settle();
    assert.deepEqual(app.edits, [["metadata", "metadata", "历史用途注释"]]);
    assert.deepEqual(app.creates, []);
    assert.deepEqual(app.requests, []);
    assert.equal(JSON.stringify(record), snapshot);
  } finally { app.close(); }
});

for (const kind of ["factor", ...stageNames]) {
  test(`retirement during ${kind} metadata editing preserves description-only save after clearing the name`, async () => {
    const record = project("metadata-poll", kind);
    const props = { kind, project: record, onClose() {} };
    const app = fixture("src/components/modal/ProjectDialog.tsx", { projects: [record], props });
    try {
      app.elements("Input")[0].props.onChange({ target: { value: "" } });
      app.elements("Textarea")[0].props.onChange({ target: { value: "保留历史用途的描述" } });
      await app.settle();
      assert.equal(app.elements("Input")[0].props.value, "");
      const retired = { ...record, retired: true, retiredReason: "版本已退役" };
      props.project = retired;
      app.state.projects = [retired];
      app.render();
      await app.settle();
      assert.equal(app.elements("Input")[0].props.disabled, true);
      assert.equal(app.elements("Input")[0].props.value, "metadata-poll");
      await app.submit();
      await app.settle();
      assert.deepEqual(app.edits, [["metadata-poll", "metadata-poll", "保留历史用途的描述"]]);
      assert.doesNotMatch(app.text(), /请输入项目名称/);
      assert.deepEqual(app.creates, []);
      assert.deepEqual(app.requests, []);
    } finally { app.close(); }
  });
}


test("empty active Scheme API results disable creation and explain unsupported/retired versions", async () => {
  const app = creation(() => []);
  try {
    await app.settle();
    assert.equal(app.button("创建项目").props.disabled, true);
    assert.deepEqual(app.options("scheme-version"), []);
    assert.match(app.html(), /暂无当前前端支持的未退役 Scheme 版本/);
    assert.match(app.html(), /已退役版本仅供历史查看/);
    app.elements("Input")[0].props.onChange({ target: { value: "新研究" } });
    await app.settle();
    await app.submit();
    assert.deepEqual(app.creates, []);
    assert.deepEqual(app.requests.map(([, url]) => url), ["/templates/scheme-versions"]);
  } finally { app.close(); }
});

test("unsupported active Scheme majors are visible but disabled without falling back to old tags", async () => {
  const app = creation(() => [{ tag: "active-2", commit: "new", version: "2.0.0" }]);
  try {
    await app.settle();
    assert.equal(app.elements("SelectItem").find((item) => item.props.value === "active-2").props.disabled, true);
    assert.equal(app.select("scheme-version").props.value, "");
    assert.equal(app.button("创建项目").props.disabled, true);
    assert.match(app.html(), /支持 Scheme 1.x/);
  } finally { app.close(); }
});

test("empty compatible Algo API results explain active templates and never create with a fallback", async () => {
  const app = creation((url) => url.startsWith("/templates/scheme-versions") ? [schemeRelease] : []);
  try {
    await app.settle();
    assert.equal(app.select("scheme-version").props.value, "v1.2.0");
    assert.deepEqual(app.options("template-version"), []);
    assert.equal(app.button("创建项目").props.disabled, true);
    assert.match(app.html(), /没有兼容所选 Scheme 的未退役 Algo 版本/);
    assert.match(app.html(), /不能回退到已退役版本/);
  } finally { app.close(); }
});

test("Scheme support is checked against template metadata, never an arbitrary release tag", async () => {
  const app = creation((url) => url.startsWith("/templates/scheme-versions") ? [{ ...schemeRelease, tag: "active-release" }] : [algoRelease]);
  try {
    await app.settle();
    assert.equal(app.select("scheme-version").props.value, "active-release");
    assert.equal(app.button("创建项目").props.disabled, false);
    assert.match(app.requests[1][1], /scheme_version=active-release/);
  } finally { app.close(); }
});

test("refreshing away a retired template clears existing selections instead of retaining an old fallback", async () => {
  let refreshed = false;
  const app = creation((url) => url.startsWith("/templates/scheme-versions") ? (refreshed ? [] : [schemeRelease]) : [algoRelease]);
  try {
    await app.settle();
    assert.equal(app.button("创建项目").props.disabled, false);
    refreshed = true;
    app.button("刷新版本").props.onClick();
    await app.settle();
    assert.equal(app.select("scheme-version").props.value, "");
    assert.equal(app.select("template-version").props.value, "");
    assert.equal(app.button("创建项目").props.disabled, true);
    assert.match(app.html(), /暂无当前前端支持的未退役 Scheme 版本/);
    assert.deepEqual(app.creates, []);
  } finally { app.close(); }
});
