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
const compiled = new Map();
const ui = new Proxy({}, { get(target, name) {
  return target[name] ??= Object.assign(() => null, { displayName: name });
} });
const scheme = (tag, version = "1.2.5") => ({ tag, version, commit: `${tag}-commit` });
const algo = (tag, version = "1.2.5") => ({ tag, version, commit: `${tag}-commit` });
const currentScheme = scheme("scheme-current"), currentAlgo = algo("algo-current");
const nextScheme = scheme("scheme-next", "1.3.0"), nextAlgo = algo("algo-next", "1.3.0");
function record(overrides = {}) {
  return {
    id: "target", name: "研究项目", description: "保留源码", kind: "model", schemeVersion: currentScheme.tag,
    schemeCommit: currentScheme.commit, algoVersion: currentAlgo.tag, algoCommit: currentAlgo.commit,
    updatedAt: "2026-10-07T00:00:00Z", retired: true,
    versions: [{ id: "historical", number: 1, status: "success", phase: "success", publishStatus: "published", retired: true,
      retiredReason: "旧 Scheme 已退役", workflowId: 1, duration: "1s", note: "saved", submittedAt: "2026-10-07",
      parameters: { factor: "{\"window\":20}" }, dependencies: [{ name: "scheme", version: "1.0.1" }] }], ...overrides
  };
}
function elements(tree, name) {
  if (Array.isArray(tree)) return tree.flatMap((child) => elements(child, name));
  if (!React.isValidElement(tree)) return [];
  return [...(tree.type === name || tree.type.displayName === name ? [tree] : []), ...elements(tree.props.children, name)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  return React.isValidElement(tree) ? text(tree.props.children) : "";
}

// Existing MJS + tsx loader pattern: real JSX, store, request normalization and
// Axios, with local promises and isolated hooks/portal primitives; no live API.
function fixture(project = record()) {
  const slots = [], requests = [], cache = new Map();
  let cursor = 0, effects = [], tree, queued = false, closed = false, closeCount = 0, store;
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
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useEffect(callback, deps) {
      const slot = slots[cursor++] ??= {};
      if (!slot.deps || deps.some((value, index) => !Object.is(value, slot.deps[index]))) {
        slot.deps = deps;
        effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); });
      }
    }
  };
  const localAxios = { isAxiosError: axios.isAxiosError, create(config) {
    return axios.create({ ...config, adapter(config) {
      let accept, fail;
      const promise = new Promise((resolve, reject) => { accept = resolve; fail = reject; });
      requests.push({ config, url: axios.getUri(config), body: config.data ? JSON.parse(config.data) : undefined,
        resolve: (data) => accept({ config, data, status: 200, statusText: "OK", headers: {} }),
        reject: (detail, status = 409) => fail(new axios.AxiosError("private transport", "ERR_BAD_RESPONSE", config, {}, {
          config, data: { detail }, status, statusText: "Conflict", headers: { Authorization: "private token" }
        }))
      });
      return promise;
    } });
  } };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    if (!compiled.has(filename)) compiled.set(filename, ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
    }).outputText);
    vm.runInNewContext(compiled.get(filename), {
      module, exports: module.exports, Error, URLSearchParams,
      require(name) {
        if (name === "react") return hooks;
        if (name === "zustand") return { create };
        if (name === "axios") return localAxios;
        if (name === "@/store/research" && store) return { useResearchStore: (selector) => selector(store.getState()) };
        if (name === "@/assets/lib/settings") return { apiUrl: "/api/v1" };
        if (name.startsWith("@/ui/")) return ui;
        if (!name.startsWith("@/") && !name.startsWith(".")) return require(name);
        const candidate = name.startsWith("@/") ? join(root, "src", name.slice(2)) : resolve(dirname(filename), name);
        const path = [candidate, `${candidate}.ts`, `${candidate}.tsx`].find(existsSync);
        if (!path) throw new Error(`Unexpected upgrade dependency: ${name}`);
        return load(path);
      }
    }, { filename });
    return module.exports;
  }
  store = load(join(root, "src/store/research.ts")).useResearchStore;
  store.setState({ projects: [project], loaded: true, loading: false, error: "" });
  const unsubscribe = store.subscribe(schedule);
  const Dialog = load(join(root, "src/components/modal/ProjectUpgradeDialog.tsx")).default;
  function render() {
    cursor = 0; effects = [];
    tree = Dialog({ project: store.getState().projects[0] ?? project, onClose() { closeCount++; } });
    effects.splice(0).forEach((effect) => effect());
  }
  const app = {
    store, requests, render, get closeCount() { return closeCount; }, get tree() { return tree; },
    node(name) { return elements(tree, name)[0]; },
    text() { return text(tree); },
    button(label) { return elements(tree, "Button").find((node) => text(node) === label); },
    select(kind) { return elements(tree, "Select").find((node) => elements(node, "SelectTrigger").some((trigger) => trigger.props.id === `upgrade-${kind}-version`)); },
    options(kind) { return elements(this.select(kind), "SelectItem"); },
    choose(kind, value) { this.select(kind).props.onValueChange(value); },
    submit() { return this.node("form").props.onSubmit({ preventDefault() {} }); },
    refresh() { this.button("刷新版本").props.onClick(); },
    settle: async () => { for (let count = 0; count < 5; count++) await new Promise(setImmediate); },
    async ready(schemes = [nextScheme, currentScheme], target = [currentAlgo]) {
      requests[0].resolve(schemes);
      await this.settle();
      assert.equal(requests.length, 2);
      requests[1].resolve(target);
      await this.settle();
      return this;
    },
    close() { closed = true; unsubscribe(); slots.forEach((slot) => slot.cleanup?.()); }
  };
  render();
  return app;
}

for (const kind of ["factor", "model", "optimize", "control", "execution"]) {
  test(`${kind} upgrade uses existing catalog and exact POST contract, preserving retired history`, async () => {
    const project = record({ kind }), snapshot = JSON.stringify(project.versions);
    const app = fixture(project);
    try {
      assert.equal(app.button("确认升级").props.disabled, true);
      assert.equal(app.requests[0].config.url, "/templates/scheme-versions");
      assert.equal(app.requests.length, 1, "no current Algo catalog is required before choosing the target");
      await app.ready();
      assert.equal(app.requests[1].config.url, `/templates/versions?kind=${kind}&scheme_version=scheme-current`);
      assert.equal(app.select("scheme").props.value, currentScheme.tag, "unchanged current Scheme is allowed");
      assert.equal(app.select("algo").props.value, currentAlgo.tag, "unchanged current Algo is allowed");
      const pending = app.submit();
      const post = app.requests.at(-1);
      assert.equal(post.url, "/api/v1/projects/target/upgrade");
      assert.equal(post.config.method, "post");
      assert.deepEqual(post.body, { scheme_version: currentScheme.tag, algo_version: currentAlgo.tag });
      post.resolve(project); // Same-target no-op is valid.
      await pending;
      await app.settle();
      assert.equal(app.closeCount, 1);
      assert.equal(JSON.stringify(app.store.getState().projects[0].versions), snapshot);
      assert.equal(app.store.getState().projects[0].versions[0].retired, true);
    } finally { app.close(); }
  });
}

test("Scheme selection clears Algo immediately and ignores late compatibility results", async () => {
  const patchScheme = scheme("scheme-patch", "1.2.7"), patchAlgo = algo("algo-patch", "1.2.8");
  const app = fixture();
  try {
    await app.ready([currentScheme, patchScheme, nextScheme]);
    app.choose("scheme", patchScheme.tag);
    await app.settle();
    const late = app.requests.at(-1);
    assert.match(late.config.url, /scheme_version=scheme-patch/);
    assert.equal(app.select("algo").props.value, "");
    assert.equal(app.button("确认升级").props.disabled, true);
    await app.submit();
    app.choose("scheme", nextScheme.tag);
    await app.settle();
    const fresh = app.requests.at(-1);
    assert.match(fresh.config.url, /scheme_version=scheme-next/);
    fresh.resolve([nextAlgo]);
    await app.settle();
    late.resolve([patchAlgo]);
    await app.settle();
    assert.equal(app.select("scheme").props.value, nextScheme.tag);
    assert.equal(app.select("algo").props.value, nextAlgo.tag);
    const pending = app.submit();
    assert.deepEqual(app.requests.at(-1).body, { scheme_version: nextScheme.tag, algo_version: nextAlgo.tag });
    app.requests.at(-1).resolve({ ...record(), schemeVersion: nextScheme.tag, algoVersion: nextAlgo.tag, retired: false });
    await pending;
    assert.equal(app.closeCount, 1);
  } finally { app.close(); }
});

test("compatible Scheme and Algo downgrades are selectable while unsupported Scheme majors stay disabled", async () => {
  const app = fixture();
  const lowerScheme = scheme("v99.0.0", "1.2.4"), unsupported = scheme("scheme-two", "2.0.0");
  const lowerAlgo = algo("v999.0.0", "1.2.4");
  try {
    await app.ready([lowerScheme, unsupported, currentScheme], [lowerAlgo, currentAlgo]);
    assert.equal(app.options("scheme").find((node) => node.props.value === lowerScheme.tag).props.disabled, false);
    assert.equal(app.options("scheme").find((node) => node.props.value === unsupported.tag).props.disabled, true);
    assert.notEqual(app.options("algo").find((node) => node.props.value === lowerAlgo.tag).props.disabled, true);
    app.choose("scheme", lowerScheme.tag);
    await app.settle();
    assert.equal(app.select("algo").props.value, "");
    assert.match(app.requests[2].config.url, /scheme_version=v99.0.0/);
    app.requests[2].resolve([lowerAlgo]);
    await app.settle();
    const pending = app.submit();
    assert.deepEqual(app.requests.at(-1).body, { scheme_version: lowerScheme.tag, algo_version: lowerAlgo.tag });
    app.requests.at(-1).resolve({ ...record(), schemeVersion: lowerScheme.tag, algoVersion: lowerAlgo.tag });
    await pending;
    assert.equal(app.closeCount, 1);
    assert.match(app.text(), /包括降低版本或保留当前版本/);
  } finally { app.close(); }
});

test("a Scheme-only patch upgrade can retain the compatible current Algo", async () => {
  const patch = scheme("patch-scheme", "1.2.8"), app = fixture();
  try {
    await app.ready([currentScheme, patch]);
    app.choose("scheme", patch.tag);
    await app.settle();
    app.requests.at(-1).resolve([currentAlgo]);
    await app.settle();
    const pending = app.submit();
    assert.deepEqual(app.requests.at(-1).body, { scheme_version: patch.tag, algo_version: currentAlgo.tag });
    app.requests.at(-1).resolve({ ...record(), schemeVersion: patch.tag });
    await pending;
  } finally { app.close(); }
});

test("a missing current release never adds a catalog prerequisite and backend compatibility failures remain local", async () => {
  const app = fixture(record({ schemeVersion: "retired-scheme", algoVersion: "retired-algo" }));
  try {
    await app.ready([currentScheme], [currentAlgo]);
    assert.equal(app.requests.length, 2);
    assert.ok(app.requests.every((request) => !request.config.url.includes("retired-scheme")));
    assert.equal(app.button("确认升级").props.disabled, false);
    const pending = app.submit();
    assert.deepEqual(app.requests.at(-1).body, { scheme_version: currentScheme.tag, algo_version: currentAlgo.tag });
    app.requests.at(-1).reject({ code: "incompatible_dependency", reason: "已安装上游包与所选 Scheme 不兼容" });
    await pending; await app.settle();
    assert.equal(app.closeCount, 0);
    assert.match(app.text(), /已安装上游包与所选 Scheme 不兼容/);
  } finally { app.close(); }
});

test("refresh invalidates submissions synchronously, clears retired selections and cannot accept old catalog responses", async () => {
  const app = fixture();
  try {
    await app.ready();
    const staleSubmit = app.node("form").props.onSubmit;
    app.refresh();
    await staleSubmit({ preventDefault() {} });
    assert.ok(app.requests.every((request) => request.config.method === "get"), "old rendered submit cannot use pre-refresh choices");
    await app.settle();
    assert.equal(app.select("scheme").props.value, "");
    assert.equal(app.select("algo").props.value, "");
    assert.equal(app.button("确认升级").props.disabled, true);
    const staleScheme = app.requests[2];
    assert.equal(staleScheme.config.url, "/templates/scheme-versions?refresh=true");
    app.refresh();
    await app.settle();
    app.requests[3].resolve([]);
    await app.settle();
    staleScheme.resolve([currentScheme]);
    await app.settle();
    assert.equal(app.select("scheme").props.value, "");
    assert.equal(app.select("algo").props.value, "");
    assert.equal(app.button("确认升级").props.disabled, true);
    assert.equal(app.requests.length, 4);
    assert.match(app.text(), /暂无受支持的活跃 Scheme/);
    assert.equal(app.closeCount, 0);
  } finally { app.close(); }
});

test("refresh of compatible Algo removes stale choices, uses refresh=true and does not resubmit retired tags", async () => {
  const app = fixture();
  try {
    await app.ready();
    app.refresh();
    await app.settle();
    app.requests[2].resolve([currentScheme]);
    await app.settle();
    assert.equal(app.select("algo").props.value, "");
    assert.match(app.requests[3].config.url, /scheme_version=scheme-current&refresh=true/);
    app.requests[3].resolve([]);
    await app.settle();
    await app.submit();
    assert.equal(app.select("algo").props.value, "");
    assert.equal(app.button("确认升级").props.disabled, true);
    assert.match(app.text(), /没有兼容所选 Scheme/);
    assert.equal(app.requests.length, 4);
  } finally { app.close(); }
});

test("busy blocks duplicate submit, cancel, Escape, outside close, catalog refresh and selection; safe failure preserves retry", async () => {
  const app = fixture();
  try {
    await app.ready();
    const submit = app.node("form").props.onSubmit, cancel = app.button("取消").props.onClick;
    const pending = submit({ preventDefault() {} });
    await submit({ preventDefault() {} });
    cancel();
    app.node("Dialog").props.onOpenChange(false);
    app.refresh();
    await app.settle();
    assert.equal(app.requests.length, 3);
    assert.equal(app.node("DialogContent").props.showCloseButton, false);
    assert.equal(app.button("取消").props.disabled, true);
    assert.equal(app.button("升级中…").props.disabled, true);
    assert.equal(app.button("刷新版本").props.disabled, true);
    assert.equal(app.select("scheme").props.disabled, true);
    assert.equal(app.select("algo").props.disabled, true);
    for (const name of ["onEscapeKeyDown", "onInteractOutside"]) {
      let prevented = false;
      app.node("DialogContent").props[name]({ preventDefault() { prevented = true; } });
      assert.equal(prevented, true);
    }
    assert.equal(app.closeCount, 0);
    app.requests[2].reject({ code: "project_kernel_busy", reason: "请先停止忙碌 Kernel", config: "private config", traceback: "private traceback" });
    await pending;
    await app.settle();
    assert.equal(app.closeCount, 0);
    assert.match(app.text(), /请先停止忙碌 Kernel/);
    assert.doesNotMatch(app.text(), /private|traceback|Authorization/);
    assert.equal(app.select("scheme").props.value, currentScheme.tag);
    assert.equal(app.select("algo").props.value, currentAlgo.tag);
    assert.equal(app.button("确认升级").props.disabled, false);
    const retry = app.submit();
    await app.settle();
    assert.doesNotMatch(app.text(), /请先停止忙碌 Kernel/);
    app.requests[3].resolve({ ...record(), retired: false });
    await retry;
    assert.equal(app.closeCount, 1);
  } finally { app.close(); }
});

test("catalog failures stay local and retry by refresh, and late responses after unmount are ignored", async () => {
  const app = fixture();
  try {
    app.requests[0].reject({ code: "catalog_unavailable", reason: "版本目录暂不可用", secret: "private" }, 503);
    await app.settle();
    assert.match(app.text(), /版本目录暂不可用/);
    assert.equal(app.button("确认升级").props.disabled, true);
    app.refresh();
    await app.settle();
    app.requests[1].resolve([currentScheme]);
    await app.settle();
    app.close();
    app.requests[2].resolve([currentAlgo]);
    await app.settle();
    assert.equal(app.closeCount, 0);
    assert.equal(app.store.getState().projects[0].schemeVersion, currentScheme.tag);
  } finally { app.close(); }
});

test("upgrade explains environment changes without promising source migration or reactivating history", () => {
  const app = fixture();
  try {
    assert.match(app.text(), /当前项目环境（非历史 run 依赖）/);
    assert.match(app.text(), /重建项目 venv.*\.solo.*pyproject.toml \/ uv.lock.*Algo 版本的依赖契约/);
    assert.match(app.text(), /不替换 src \/ Notebook，不迁移参数或代码/);
    assert.match(app.text(), /闲置 Kernel 会关闭，忙碌 Kernel 需先停止/);
    assert.match(app.text(), /跨 minor 不兼容会拒绝升级，不会自动卸载或升级/);
    assert.match(app.text(), /不会使历史退役 run 恢复活跃/);
  } finally {
    app.close();
    app.requests.forEach((request) => request.resolve([]));
  }
});
