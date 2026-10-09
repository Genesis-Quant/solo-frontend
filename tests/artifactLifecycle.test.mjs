import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const ts = require("typescript"), React = require("react"), axios = require("axios");
const { create } = require("zustand");
const stages = ["model", "optimize", "control", "execution"];
const ui = new Proxy({}, { get(target, name) { target[name] ??= Object.assign(() => null, { displayName: name }); return target[name]; } });
const compiled = new Map();

function artifact(id = "model-release", kind = "model", overrides = {}) {
  return {
    id, kind, package: `${kind}-1234`, version: "1.2.1", sha256: "a".repeat(64),
    filename: `${kind}_1234-1.2.1-py3-none-any.whl`, sizeBytes: 2048, entry: "algo:entry", schemeVersion: "1.2.7",
    sources: { scheme: { version: "1.2.7", tag: "v1.2.7", commit: "accepted-commit" } }, dependencies: {},
    sourceProjectId: "deleted-source", sourceProjectName: "历史来源", sourceVersionId: "deleted-version", publishedAt: "2026-10-07T00:00:00Z",
    retired: false, retiredReason: null, ...overrides
  };
}
function project(overrides = {}, versionOverrides = {}) {
  return {
    id: "source-project", name: "研究模型", kind: "model", description: "saved source", schemeVersion: "1.2.7", algoVersion: "v1.2.7",
    directory: "/home/jupyter/projects/source-project", updatedAt: "2026-10-07T00:00:00Z", ...overrides,
    versions: [{ id: "saved-version", number: 1, packageVersion: "1.2.1", phase: "success", note: "saved",
      submittedAt: "2026-10-07", status: "success", publishStatus: "unpublished", workflowId: 12, duration: "1s", parameters: {}, dependencies: [], ...versionOverrides }]
  };
}
function elements(tree, name) {
  if (Array.isArray(tree)) return tree.flatMap((child) => elements(child, name));
  if (!React.isValidElement(tree)) return [];
  const matches = tree.type === name || tree.type.displayName === name ? [tree] : [];
  return [...matches, ...elements(tree.props.children, name)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  return React.isValidElement(tree) ? text(tree.props.children) : "";
}

// Real Zustand, Axios normalization, registry hook, JSX and event handlers;
// isolated hooks/portal primitives and adapter promises cannot reach a live API.
function fixture(component = "StrategyDialog", records = []) {
  const slots = [], requests = [], created = [], navigations = [];
  let cursor = 0, effects = [], tree, queued = false, closed = false, renderPaused = false;
  const cache = new Map();
  function schedule() {
    if (queued || closed) return;
    queued = true;
    queueMicrotask(() => { queued = false; if (!closed && !renderPaused) render(); });
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
    useRef(initial) { const slot = slots[cursor++] ??= { current: initial }; return slot; },
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
        slot.value = factory(); slot.deps = deps;
      }
      return slot.value;
    },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); }
  };
  const localAxios = {
    isAxiosError: axios.isAxiosError,
    create(config) { return axios.create({ ...config, adapter(config) {
      let accept, fail;
      const promise = new Promise((resolve, reject) => { accept = resolve; fail = reject; });
      requests.push({ config,
        body: config.data ? JSON.parse(config.data) : undefined,
        resolve: (data, status = 200) => accept({ config, data, status, statusText: status === 204 ? "No Content" : "OK", headers: {} }),
        reject: (detail, status = 409) => fail(new axios.AxiosError("private transport", "ERR_BAD_RESPONSE", config, {}, {
          config, data: { detail }, status, statusText: "Conflict", headers: { Authorization: "private" }
        })),
        rejectNetwork: (code = "ERR_NETWORK") => fail(new axios.AxiosError("private transport", code, config, {}))
      });
      return promise;
    } }); }
  };
  let store;
  const overrides = {
    react: hooks, zustand: { create }, axios: localAxios,
    "react-router-dom": { Link: ui.Link },
    "@/assets/lib/settings": { apiUrl: "/api/v1" },
    "@/store/pageMemory": { usePageState: (_scope, _name, initial) => hooks.useState(initial), lastPrimaryPage: () => "/projects/model" },
    "@/hooks/useProjectTable": { useProjectTable: (_scope, rows) => ({ rows, resetPage() {} }) },
    "@/components/bar/PageHeader": { PageHeader: ui.PageHeader, pageContainer: "page-container" },
    "@/components/table/ProjectDataTable": { __esModule: true, default: ui.ProjectDataTable },
    "@/components/field/SchemaFields": { __esModule: true, default: ui.SchemaFields },
    "@/components/modal/ProjectDialog": { __esModule: true, default: ui.ProjectDialog },
    "@/components/modal/TaskLogDialog": { __esModule: true, default: ui.TaskLogDialog },
    "@/components/panel/ReportSkeleton": { __esModule: true, default: ui.ReportSkeleton },
    "@/components/panel/ResearchReport": { __esModule: true, default: ui.ResearchReport },
    "@/assets/lib/reports": { loadReport: async () => ({ files: {} }) }
  };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    if (!compiled.has(filename)) {
      const extra = filename.endsWith("ProjectPage.tsx") ? "\nexport { ProjectDetail, VersionActions, ExecutionState };" : "";
      compiled.set(filename, ts.transpileModule(readFileSync(filename, "utf8").replaceAll("import.meta.env.VITE_JUPYTER_URL", "undefined") + extra, {
        fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
      }).outputText);
    }
    vm.runInNewContext(compiled.get(filename), {
      module, exports: module.exports, Error, AbortController,
      window: { location: { assign: (url) => navigations.push(url) } },
      require(name) {
        if (name === "@/store/research" && store) return { useResearchStore: (selector) => selector(store.getState()) };
        if (Object.hasOwn(overrides, name)) return overrides[name];
        if (name.startsWith("@/ui/")) return ui;
        if (!name.startsWith("@/") && !name.startsWith(".")) return require(name);
        const candidate = name.startsWith("@/") ? join(root, "src", name.slice(2)) : resolve(dirname(filename), name);
        const path = [candidate, `${candidate}.ts`, `${candidate}.tsx`].find(existsSync);
        if (!path) throw new Error(`Unexpected lifecycle dependency ${name}`);
        return load(path);
      }
    }, { filename });
    return module.exports;
  }
  store = load(join(root, "src/store/research.ts")).useResearchStore;
  store.setState({ projects: records, loaded: true, loading: false, error: "" });
  const unsubscribe = store.subscribe(schedule);
  const page = ["VersionActions", "ProjectDetail", "ExecutionState"].includes(component)
    ? "views/ProjectPage.tsx"
    : component === "ArtifactsPage" ? "views/ArtifactsPage.tsx" : "components/modal/StrategyDialog.tsx";
  const exports = load(join(root, "src", page));
  const Component = exports[component] ?? exports.default;
  let props = component === "StrategyDialog" ? { onClose() {}, onCreated: (record) => created.push(record) } : {};
  const app = {
    store, requests, created, navigations,
    get tree() { return tree; }, render,
    pauseRendering() { renderPaused = true; },
    resumeRendering() { renderPaused = false; render(); },
    setProps(value) { props = value; render(); },
    node(name) { return elements(tree, name)[0]; },
    get table() { return this.node("ProjectDataTable"); },
    actions(row = this.table.props.rows[0]) { return this.table.props.columns.find((column) => column.id === "actions").cell(row, this.table.props.rowHref(row)); },
    openDelete(row) { elements(this.actions(row), "Button").find((node) => node.props["aria-label"]?.startsWith("删除 ")).props.onClick(); },
    confirmDelete() {
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
      const pending = this.node("AlertDialogAction").props.onClick(event);
      assert.equal(event.prevented, true, "the dialog action must not auto-close before the API completes");
      return pending;
    },
    refresh() { elements(this.node("PageHeader").props.actions, "Button").find((node) => text(node) === "刷新").props.onClick(); },
    button(label) { return elements(tree, "Button").find((node) => text(node) === label); },
    select(kind) { return elements(tree, "Select").find((node) => elements(node, "SelectTrigger").some((trigger) => trigger.props.id === `strategy-${kind}`)); },
    options(kind) { return elements(this.select(kind), "SelectItem").map((node) => node.props.value); },
    choose(kind, id) { this.select(kind).props.onValueChange(id); },
    submit() { return elements(tree, "form")[0].props.onSubmit({ preventDefault() {} }); },
    settle: async () => { for (let count = 0; count < 5; count++) await new Promise(setImmediate); },
    close() { closed = true; unsubscribe(); slots.forEach((slot) => slot.cleanup?.()); }
  };
  function render() {
    cursor = 0; effects = [];
    const record = store.getState().projects[0];
    if (["VersionActions", "ProjectDetail"].includes(component)) props = { project: record, version: record.versions[0], onLogs() {}, selectVersion() {} };
    tree = Component(props);
    effects.splice(0).forEach((effect) => effect());
  }
  if (component !== "ExecutionState") render();
  return app;
}

test("source-deleted published artifacts are selectable and default stages are omitted on both requests", async () => {
  const app = fixture();
  try {
    assert.equal(app.requests[0].config.url, "/artifacts?published=true");
    assert.equal(app.requests[0].config.method, "get");
    app.requests[0].resolve([artifact(), artifact("retired", "model", { retired: true }), artifact("candidate", "model", { publishedAt: null })]);
    await app.settle();
    assert.equal(app.store.getState().projects.length, 0, "no source lookup exists");
    assert.deepEqual(app.options("model"), ["model-release"]);
    app.choose("model", "model-release"); await app.settle();
    assert.match(text(app.tree), /历史来源.*model-1234/);
    const advance = app.submit();
    assert.deepEqual(app.requests[1].body, { artifacts: { model: "model-release" } });
    const forms = Object.fromEntries(stages.map((kind) => [kind, { schema: { properties: {} }, values: {} }]));
    app.requests[1].resolve(forms); await advance; await app.settle();
    for (let step = 1; step < 4; step++) { await app.submit(); await app.settle(); }
    const created = app.submit();
    assert.deepEqual(app.requests[2].body.selections, { artifacts: { model: "model-release" } });
    assert.deepEqual(Object.keys(app.requests[2].body.forms), stages);
    app.requests[2].resolve({ id: "independent-strategy" }); await created; await app.settle();
    assert.equal(app.created[0].id, "independent-strategy");
  } finally { app.close(); }
});

test("catalog reload invalidates choices that disappear or retire", async () => {
  const app = fixture();
  try {
    app.requests[0].resolve([artifact(), artifact("optimize-release", "optimize"), artifact("other-minor", "optimize", { schemeVersion: "1.3.0" })]);
    await app.settle(); app.choose("model", "model-release"); await app.settle();
    assert.deepEqual(app.options("optimize"), ["default", "optimize-release"]);
    app.choose("optimize", "optimize-release"); await app.settle();
    app.button("刷新成果").props.onClick(); await app.settle();
    app.requests[1].resolve([artifact("model-release", "model", { retired: true })]); await app.settle();
    assert.equal(elements(app.tree, "Button").find((node) => node.props.type === "submit").props.disabled, true);
    await app.submit(); await app.settle();
    assert.equal(app.requests.length, 2, "retired selections cannot request Forms");
    assert.match(text(app.tree), /所选已发布成果已退役/);
  } finally { app.close(); }
});

test("a refreshed independent catalog ignores a late superseded GET", async () => {
  const app = fixture("ArtifactsPage");
  try {
    const actions = elements(app.tree, "PageHeader")[0].props.actions;
    elements(actions, "Button").find((node) => text(node) === "刷新").props.onClick(); await app.settle();
    assert.equal(app.requests.length, 2);
    app.requests[1].resolve([artifact("new-release")]); await app.settle();
    app.requests[0].resolve([artifact("stale-release")]); await app.settle();
    assert.deepEqual(Array.from(elements(app.tree, "ProjectDataTable")[0].props.rows, (row) => row.id), ["new-release"]);
  } finally { app.close(); }
});

test("artifact choices send stage IDs, default removal omits keys, and model changes reset downstream choices", async () => {
  const app = fixture();
  try {
    app.requests[0].resolve([artifact(), artifact("second-model", "model"), artifact("optimize-release", "optimize"),
      artifact("control-release", "control"), artifact("execution-release", "execution")]);
    await app.settle(); app.choose("model", "model-release"); await app.settle();
    for (const kind of stages.slice(1)) { app.choose(kind, `${kind}-release`); await app.settle(); }
    app.choose("control", "default"); await app.settle();
    const pending = app.submit();
    assert.deepEqual(app.requests[1].body, { artifacts: { model: "model-release", optimize: "optimize-release", execution: "execution-release" } });
    app.requests[1].reject({ code: "component_unavailable", reason: "成果已退役" }, 422);
    await pending; await app.settle();
    app.choose("model", "second-model"); await app.settle();
    for (const kind of stages.slice(1)) assert.equal(app.select(kind).props.value, "default");
    const retry = app.submit();
    assert.deepEqual(app.requests[2].body, { artifacts: { model: "second-model" } });
    app.requests[2].resolve(Object.fromEntries(stages.map((kind) => [kind, { schema: {}, values: {} }])));
    await retry;
  } finally { app.close(); }
});

test("independent catalog shows real metadata/download and informational source snapshots after source deletion", async () => {
  const app = fixture("ArtifactsPage");
  try {
    app.requests[0].resolve([artifact(), artifact("historical-retired", "factor", { retired: true, retiredReason: "Scheme 已退役" }), artifact("not-published", "model", { publishedAt: null })]);
    await app.settle();
    const table = elements(app.tree, "ProjectDataTable")[0];
    assert.deepEqual(Array.from(table.props.rows, (row) => row.id), ["model-release", "historical-retired"]);
    const row = table.props.rows[0], href = table.props.rowHref(row);
    assert.equal(href, "/api/v1/artifacts/model-release/wheel");
    const metadata = table.props.columns.find((column) => column.id === "package").cell(row, href);
    assert.match(text(metadata), /model_1234-1.2.1-py3-none-any.whl.*2.0 KB/);
    assert.equal(elements(metadata, "a")[0].props.download, true);
    const source = table.props.columns.find((column) => column.id === "source").cell(row);
    assert.equal(text(source), "历史来源");
    assert.equal(elements(source, "Link").length, 0, "a historical source must not become a mandatory live link");
    assert.match(text(app.tree), /删除源项目不会移除成果/);
    assert.equal(app.store.getState().projects.length, 0);
  } finally { app.close(); }
});

test("artifact row actions preserve downloads, stop row events, and cancel confirmation without DELETE", async () => {
  const app = fixture("ArtifactsPage");
  try {
    const target = artifact("delete-target", "model", { retired: true, dependencies: { model: "shared-release" } });
    const other = artifact("other-target", "model", { version: "1.2.2" });
    app.requests[0].resolve([target, other]); await app.settle();
    const column = app.table.props.columns.find((item) => item.id === "actions");
    assert.equal(column.label, "操作");
    assert.equal(column.size, 112);
    const actions = app.actions(target), download = elements(actions, "a")[0];
    assert.equal(download.props.href, "/api/v1/artifacts/delete-target/wheel");
    assert.equal(download.props.download, true);
    assert.equal(download.props["aria-label"], `下载 ${target.filename}`);
    let stopped = 0;
    const stopPropagation = () => { stopped++; };
    actions.props.onClick({ stopPropagation });
    for (const key of ["Enter", " "]) actions.props.onKeyDown({ key, stopPropagation });
    assert.equal(stopped, 3);
    assert.equal(app.navigations.length, 0);
    const remove = elements(actions, "Button").find((node) => node.props["aria-label"] === "删除 model-1234 1.2.1");
    assert.equal(remove.props.disabled, false, "retirement, historical sources and guessed dependency references must not disable deletion");
    assert.equal(elements(app.actions(other), "Button").find((node) => node.props["aria-label"]?.startsWith("删除 ")).props["aria-label"], "删除 model-1234 1.2.2");
    app.openDelete(target); await app.settle();
    assert.equal(app.node("AlertDialog").props.open, true);
    assert.match(text(app.node("AlertDialogTitle")), /model-1234 1.2.1/);
    for (const value of [target.package, target.version, target.filename, target.sha256, target.id]) assert.ok(text(app.tree).includes(value));
    assert.ok(elements(app.tree, "dd").every((node) => node.props.className.includes("break-all")));
    assert.match(text(app.node("AlertDialogDescription")), /永久删除.*登记记录、wheel 及发布环境.*冻结任务的副本和历史报告保留.*不再可下载或用于新安装、策略组装.*项目、其他成果或在途安装引用/);
    app.node("AlertDialogCancel").props.onClick(); await app.settle();
    assert.equal(app.node("AlertDialog").props.open, false);
    assert.equal(app.requests.length, 1, "opening and cancelling never request DELETE");
  } finally { app.close(); }
});

test("artifact deletion waits for 204, blocks duplicate/close events, then refreshes without hiding a new UUID", async () => {
  const app = fixture("ArtifactsPage");
  try {
    const target = artifact("delete-target"), survivor = artifact("survivor", "optimize");
    app.requests[0].resolve([target, survivor]); await app.settle();
    app.openDelete(target); await app.settle();
    const pending = app.confirmDelete();
    await app.confirmDelete();
    app.node("AlertDialog").props.onOpenChange(false);
    app.node("AlertDialogCancel").props.onClick();
    let escaped = false;
    app.node("AlertDialogContent").props.onEscapeKeyDown({ preventDefault() { escaped = true; } });
    assert.equal(escaped, true, "even before rerender, pending deletion suppresses Escape");
    await app.settle();
    assert.equal(app.requests.length, 2, "synchronous double-clicks cannot issue duplicate DELETEs");
    assert.equal(app.requests[1].config.method, "delete");
    assert.equal(app.requests[1].config.url, "/artifacts/delete-target");
    assert.equal(app.requests[1].body, undefined);
    assert.equal(app.node("AlertDialog").props.open, true);
    assert.equal(app.node("AlertDialogCancel").props.disabled, true);
    assert.equal(app.node("AlertDialogAction").props.disabled, true);
    assert.equal(text(app.node("AlertDialogAction")), "删除中…");
    assert.deepEqual(Array.from(app.table.props.rows, (row) => row.id), [target.id, survivor.id], "no optimistic deletion");
    const oldError = app.store.getState().error;
    app.requests[1].resolve(undefined, 204); await pending; await app.settle();
    assert.equal(app.node("AlertDialog").props.open, false);
    assert.deepEqual(Array.from(app.table.props.rows, (row) => row.id), [survivor.id]);
    assert.equal(app.requests[2].config.method, "get");
    assert.equal(app.requests[2].config.url, "/artifacts?published=true");
    const republished = artifact("new-same-package");
    app.requests[2].resolve([survivor, republished]); await app.settle();
    assert.deepEqual(Array.from(app.table.props.rows, (row) => row.id), [survivor.id, republished.id]);
    assert.equal(app.node("PageHeader").props.count, 2);
    assert.equal(app.store.getState().error, oldError);
    assert.equal(app.navigations.length, 0);
  } finally { app.close(); }
});

test("an explicit DELETE 404 is idempotent success and refreshes the catalog", async () => {
  const app = fixture("ArtifactsPage");
  try {
    app.requests[0].resolve([artifact()]); await app.settle();
    app.openDelete(); await app.settle();
    const pending = app.confirmDelete();
    app.requests[1].reject("成果已不存在", 404); await pending; await app.settle();
    assert.equal(app.node("AlertDialog").props.open, false);
    assert.equal(app.table.props.rows.length, 0);
    assert.equal(elements(app.tree, "Alert").length, 0);
    app.requests[2].resolve([]); await app.settle();
    assert.equal(app.node("PageHeader").props.count, 0);
    assert.equal(app.store.getState().error, "");
  } finally { app.close(); }
});

test("artifact-in-use failure displays the real reason locally and retries the same UUID", async () => {
  const app = fixture("ArtifactsPage");
  try {
    const target = artifact("busy-target");
    app.requests[0].resolve([target]); await app.settle();
    app.openDelete(target); await app.settle();
    const pending = app.confirmDelete();
    app.requests[1].reject({ code: "artifact_in_use", message: "成果仍在使用", reason: "项目 quant-project 的安装仍在进行" }, 409);
    await pending; await app.settle();
    assert.match(text(app.tree), /删除失败：项目 quant-project 的安装仍在进行/);
    assert.doesNotMatch(text(app.tree), /private transport|Authorization/);
    assert.equal(app.node("AlertDialog").props.open, true);
    assert.equal(app.node("AlertDialogAction").props.disabled, false);
    assert.equal(text(app.node("AlertDialogAction")), "重试删除");
    assert.deepEqual(Array.from(app.table.props.rows, (row) => row.id), [target.id]);
    assert.equal(app.requests.length, 2, "a rejected deletion must not trigger a catalog refresh");
    assert.equal(app.store.getState().error, "");
    const retry = app.confirmDelete(); await app.settle();
    assert.equal(app.requests[2].config.url, "/artifacts/busy-target");
    assert.doesNotMatch(text(app.tree), /项目 quant-project 的安装仍在进行/);
    app.requests[2].resolve(undefined, 204); await retry; await app.settle();
    app.requests[3].resolve([]); await app.settle();
    assert.equal(app.node("AlertDialog").props.open, false);
  } finally { app.close(); }
});

test("non-404 failures including misleading not-found codes retain the row and allow retry", async () => {
  const failures = [
    { status: 403, detail: { code: "artifact_not_found", reason: "没有删除权限" }, reason: "没有删除权限" },
    { status: 503, detail: { code: "artifact_cleanup_incomplete", reason: "文件清理未确认", deleted: true, id: "wrong-uuid" }, reason: "文件清理未确认" },
    { status: 502, detail: "服务暂时不可用", reason: "服务暂时不可用" },
    { code: "ERR_NETWORK", reason: "无法连接 Solo 服务" },
    { code: "ECONNABORTED", reason: "Solo 服务请求超时，请稍后重试" }
  ];
  for (const failure of failures) {
    const app = fixture("ArtifactsPage");
    try {
      app.requests[0].resolve([artifact()]); await app.settle();
      app.openDelete(); await app.settle();
      const pending = app.confirmDelete();
      if (failure.status) app.requests[1].reject(failure.detail, failure.status);
      else app.requests[1].rejectNetwork(failure.code);
      await pending; await app.settle();
      assert.ok(text(app.tree).includes(`删除失败：${failure.reason}`));
      assert.equal(app.node("AlertDialog").props.open, true);
      assert.equal(app.node("AlertDialogCancel").props.disabled, false);
      assert.equal(text(app.node("AlertDialogAction")), "重试删除");
      assert.deepEqual(Array.from(app.table.props.rows, (row) => row.id), ["model-release"]);
      assert.equal(app.requests.length, 2);
      assert.equal(app.store.getState().error, "");
      app.node("AlertDialogCancel").props.onClick(); await app.settle();
      app.openDelete(); await app.settle();
      assert.doesNotMatch(text(app.tree), /删除失败/);
      assert.equal(text(app.node("AlertDialogAction")), "删除成果");
    } finally { app.close(); }
  }
});

test("a confirmation is an immutable UUID/metadata snapshot even when refresh replaces its row", async () => {
  const app = fixture("ArtifactsPage");
  try {
    const target = artifact("original-uuid");
    app.requests[0].resolve([{ ...target }]); await app.settle();
    const original = app.table.props.rows[0];
    app.openDelete(original); await app.settle();
    original.filename = "mutated-metadata.whl";
    app.refresh(); await app.settle();
    const replacement = artifact("replacement-uuid", "model", { sha256: "b".repeat(64), filename: "replacement.whl" });
    app.requests[1].resolve([replacement]); await app.settle();
    assert.deepEqual(Array.from(app.table.props.rows, (row) => row.id), [replacement.id]);
    assert.ok(text(app.tree).includes(target.filename));
    assert.ok(text(app.tree).includes(target.sha256));
    assert.doesNotMatch(text(app.tree), /mutated-metadata.whl|replacement.whl|replacement-uuid/);
    const pending = app.confirmDelete();
    assert.equal(app.requests[2].config.url, "/artifacts/original-uuid");
    app.requests[2].resolve(undefined, 204); await pending; await app.settle();
    assert.deepEqual(Array.from(app.table.props.rows, (row) => row.id), [replacement.id]);
    app.requests[3].resolve([replacement]); await app.settle();
  } finally { app.close(); }
});

test("partial artifact cleanup keeps the original snapshot and retries cleanup after its catalog row disappears", async () => {
  const app = fixture("ArtifactsPage");
  try {
    const target = artifact("cleanup-target"), replacement = artifact("new-same-name");
    app.requests[0].resolve([target]); await app.settle();
    app.openDelete(target); await app.settle();
    const pending = app.confirmDelete();
    app.requests[1].reject({ code: "artifact_cleanup_incomplete", reason: "发布目录暂时无法清理", deleted: true, id: target.id }, 503);
    await pending; await app.settle();
    assert.equal(app.node("AlertDialog").props.open, true);
    assert.equal(app.table.props.rows.length, 0, "explicit matching deleted metadata acknowledges registry removal, not cleanup success");
    assert.equal(text(app.node("AlertDialogAction")), "重试清理");
    assert.match(text(app.tree), /发布目录暂时无法清理.*登记记录已删除.*不会删除后来发布的同名成果/);
    app.requests[2].resolve([replacement]); await app.settle();
    assert.deepEqual(Array.from(app.table.props.rows, (row) => row.id), [replacement.id]);
    assert.ok(text(app.tree).includes(target.id));
    assert.ok(text(app.tree).includes(target.sha256));
    const retry = app.confirmDelete(); await app.settle();
    assert.equal(app.requests[3].config.url, "/artifacts/cleanup-target");
    app.requests[3].reject("发布目录仍不可访问", 503); await retry; await app.settle();
    assert.equal(text(app.node("AlertDialogAction")), "重试清理", "an ordinary retry failure must not lose the acknowledged deleted state");
    assert.deepEqual(Array.from(app.table.props.rows, (row) => row.id), [replacement.id]);
    assert.equal(app.requests.length, 4);
    const complete = app.confirmDelete();
    assert.equal(app.requests[4].config.url, "/artifacts/cleanup-target");
    app.requests[4].resolve(undefined, 204); await complete; await app.settle();
    app.requests[5].resolve([replacement]); await app.settle();
    assert.equal(app.node("AlertDialog").props.open, false);
    assert.equal(app.store.getState().error, "");
    app.openDelete(replacement); await app.settle();
    assert.equal(text(app.node("AlertDialogAction")), "删除成果");
    assert.doesNotMatch(text(app.tree), /登记记录已删除|发布目录/);
  } finally { app.close(); }
});

test("a pre-deletion GET cannot resurrect a removed row even before React processes effect cleanup", async () => {
  const app = fixture("ArtifactsPage");
  try {
    const target = artifact("delete-target"), survivor = artifact("survivor", "control");
    app.requests[0].resolve([target, survivor]); await app.settle();
    app.openDelete(target); await app.settle();
    app.refresh(); await app.settle();
    const pending = app.confirmDelete();
    assert.equal(app.requests[1].config.method, "get");
    assert.equal(app.requests[2].config.method, "delete");
    app.pauseRendering();
    app.requests[2].resolve(undefined, 204); await pending; await app.settle();
    app.requests[1].resolve([target, survivor]); await app.settle();
    app.resumeRendering(); await app.settle();
    assert.deepEqual(Array.from(app.table.props.rows, (row) => row.id), [survivor.id]);
    assert.equal(app.requests[3].config.method, "get");
    app.requests[3].resolve([survivor]); await app.settle();
    assert.deepEqual(Array.from(app.table.props.rows, (row) => row.id), [survivor.id]);
  } finally { app.close(); }
});

test("a superseded catalog error cannot leak into a successful deletion while post-delete GET failure stays local", async () => {
  const app = fixture("ArtifactsPage");
  try {
    app.requests[0].resolve([artifact()]); await app.settle();
    app.openDelete(); await app.settle();
    app.refresh(); await app.settle();
    const pending = app.confirmDelete();
    app.pauseRendering();
    app.requests[2].resolve(undefined, 204); await pending; await app.settle();
    app.requests[1].reject("过期读取失败", 500); await app.settle();
    app.resumeRendering(); await app.settle();
    assert.doesNotMatch(text(app.tree), /过期读取失败/);
    assert.equal(app.node("AlertDialog").props.open, false);
    app.requests[3].reject("刷新成果失败，请重试", 503); await app.settle();
    assert.match(text(app.tree), /刷新成果失败，请重试/);
    assert.equal(app.table.props.rows.length, 0);
    assert.equal(app.store.getState().error, "");
    app.refresh(); await app.settle();
    app.requests[4].resolve([artifact("new-release")]); await app.settle();
    assert.deepEqual(Array.from(app.table.props.rows, (row) => row.id), ["new-release"]);
    assert.doesNotMatch(text(app.tree), /刷新成果失败/);
  } finally { app.close(); }
});

test("publication has local pending/conflict/retry state and updates actual metadata through the real store", async () => {
  const app = fixture("VersionActions", [project()]);
  try {
    app.button("发布版本").props.onClick(); await app.settle();
    const pending = app.button("确认发布").props.onClick(); await app.settle();
    assert.equal(app.button("发布中…").props.disabled, true);
    assert.equal(app.button("取消").props.disabled, true);
    assert.equal(app.requests[0].config.url, "/projects/source-project/versions/saved-version/publish");
    assert.deepEqual(app.requests[0].body, {});
    assert.equal(app.store.getState().projects[0].versions[0].publishStatus, "unpublished");
    assert.equal(app.store.getState().error, "");
    await app.button("发布中…").props.onClick();
    assert.equal(app.requests.length, 1, "pending publication cannot be submitted twice");
    app.requests[0].reject({ code: "artifact_release_conflict", reason: "包版本内容冲突" });
    await pending; await app.settle();
    assert.match(text(app.tree), /发布失败.*包版本内容冲突/);
    assert.equal(app.store.getState().error, "", "publication failure never hides the page through global error state");
    const retry = app.button("重试发布").props.onClick(); await app.settle();
    const accepted = artifact("accepted-publication");
    app.requests[1].resolve({ ...app.store.getState().projects[0].versions[0], publishStatus: "published", artifactId: accepted.id, artifact: accepted });
    await retry; await app.settle();
    assert.equal(app.button("已发布").props.disabled, true);
    assert.equal(app.button("重试发布"), undefined);
    assert.doesNotMatch(text(app.tree), /包版本内容冲突/);
    assert.equal(app.store.getState().projects[0].versions[0].artifact.filename, accepted.filename);
    assert.equal(app.store.getState().error, "");
  } finally { app.close(); }
});

test("ProjectDetail never fabricates artifact filenames/sizes and uses accepted registry metadata", async () => {
  const missing = fixture("ProjectDetail", [project()]);
  try {
    await missing.settle();
    assert.match(text(missing.tree), /包版本 1.2.1.*暂无已登记的包元数据/);
    assert.doesNotMatch(text(missing.tree), /solo_.*whl|148 KB|86 KB|4 KB|source-v.*tar.gz|manifest.json/);
  } finally { missing.close(); }
  const accepted = artifact("independent-release");
  const real = fixture("ProjectDetail", [project({}, { publishStatus: "published", artifactId: accepted.id, artifact: accepted })]);
  try {
    await real.settle();
    const link = elements(real.tree, "a").find((node) => node.props.download && text(node) === accepted.filename);
    assert.equal(link.props.href, "/api/v1/artifacts/independent-release/wheel");
    assert.match(text(real.tree), /model-1234.*1.2.1.*2.0 KB.*SHA256/);
  } finally { real.close(); }
});

test("execution uses actual raw phase and never invents a percentage or trading-day count", () => {
  const app = fixture("ExecutionState");
  try {
    app.setProps({ version: project({}, { status: "running", phase: "queued" }).versions[0], onLogs() {} });
    assert.match(text(app.tree), /当前状态：排队中/);
    assert.equal(elements(app.tree, "Progress").length, 0);
    assert.doesNotMatch(text(app.tree), /180|363|50%|交易日/);
  } finally { app.close(); }
});
