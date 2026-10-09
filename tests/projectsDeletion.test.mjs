import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { RequestError } from "../src/assets/lib/requestError.ts";

const requireProject = createRequire(new URL("../package.json", import.meta.url));
const ts = requireProject("typescript");
const React = requireProject("react");
const filename = fileURLToPath(new URL("../src/views/ProjectsPage.tsx", import.meta.url));
const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
  fileName: filename,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
}).outputText;
const ui = new Proxy({}, { get(target, name) {
  return target[name] ??= Object.assign(() => null, { displayName: name });
} });

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
function project(id) {
  return {
    id, name: id, description: "研究项目", kind: "model", archived: false,
    directory: `/home/jupyter/projects/研究项目 (${id})`, schemeVersion: "1.2.0", algoVersion: "v1.2.0",
    updatedAt: "2026-10-07T00:00:00Z", versions: []
  };
}

// Follow the existing retirement UI tests: run the real JSX and event handlers,
// isolate React hooks/portal primitives, and keep all deletions in local promises.
function fixture() {
  const slots = [], requests = [];
  let cursor = 0, tree;
  const hooks = {
    ...React,
    useState(initial) {
      const slot = slots[cursor++] ??= { value: typeof initial === "function" ? initial() : initial };
      return [slot.value, (update) => { slot.value = typeof update === "function" ? update(slot.value) : update; }];
    },
    useMemo(factory, deps) {
      const slot = slots[cursor++] ??= {};
      if (!slot.deps || deps.some((value, index) => !Object.is(value, slot.deps[index]))) {
        slot.value = factory();
        slot.deps = deps;
      }
      return slot.value;
    },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); }
  };
  const projects = [project("one"), project("two")];
  const state = { projects, removeProject(...args) {
    let resolve, reject;
    const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
    requests.push({ args, resolve, reject });
    return promise;
  } };
  const overrides = {
    react: hooks,
    "@/assets/lib/requestError": { RequestError },
    "react-router-dom": { Link: ui.Link, useNavigate: () => () => {} },
    "@/components/modal/ProjectDialog": { __esModule: true, default: ui.ProjectDialog },
    "@/components/table/ProjectDataTable": { __esModule: true, default: ui.ProjectDataTable },
    "@/hooks/useProjectTable": { useProjectTable: () => ({ resetPage() {} }) },
    "@/components/bar/PageHeader": { PageHeader: ui.PageHeader, pageContainer: "page-container" },
    "@/store/pageMemory": { usePageState: (_scope, _key, initial) => hooks.useState(initial) },
    "@/store/research": { useResearchStore: (selector) => selector(state) },
    "@/types/research": { kindLabels: { model: "策略建模" }, publishLabels: {}, runLabels: {} }
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, Error,
    require(name) {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name.startsWith("@/ui/")) return ui;
      if (!name.startsWith("@/")) return requireProject(name);
      throw new Error(`Unexpected deletion UI dependency: ${name}`);
    }
  }, { filename });
  const Page = module.exports.default;
  const app = {
    projects, requests, state,
    render() { cursor = 0; tree = Page({ kind: "model" }); },
    node(name) { return elements(tree, name)[0]; },
    checkbox() { return elements(tree, "input").find((node) => node.props.type === "checkbox"); },
    open(record = projects[0]) {
      const actions = this.node("ProjectDataTable").props.columns.find((column) => column.id === "actions").cell(record);
      elements(actions, "DropdownMenuItem").find((node) => text(node) === "删除项目").props.onSelect();
      this.render();
    },
    check(checked) { this.checkbox().props.onChange({ target: { checked } }); this.render(); },
    close() { this.node("AlertDialog").props.onOpenChange(false); this.render(); },
    confirm() {
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
      const pending = this.node("AlertDialogAction").props.onClick(event);
      assert.equal(event.prevented, true, "Radix must not close the dialog before API settlement");
      this.render();
      return pending;
    }
  };
  app.render();
  return app;
}

function assertReset(app) {
  assert.equal(app.checkbox().props.checked, true);
  assert.equal(app.node("Alert"), undefined);
  assert.equal(app.node("AlertDialogAction").props.disabled, false);
  assert.equal(text(app.node("AlertDialogAction")), "删除项目");
}

test("true deletion defaults to a checked native workspace-only checkbox with exact directory and truthful warning", () => {
  const app = fixture();
  app.open();
  assert.equal(app.node("AlertDialog").props.open, true);
  assertReset(app);
  assert.equal(app.checkbox().type, "input");
  assert.equal(app.checkbox().props.disabled, false);
  const label = app.node("Label");
  assert.equal(label.props.htmlFor, app.checkbox().props.id);
  assert.equal(text(label), "同时删除 Jupyter 中的项目文件夹");
  assert.equal(text(app.node("code")), app.projects[0].directory);
  assert.equal(app.node("code").props.children, app.projects[0].directory, "do not reconstruct or normalize the directory");
  assert.match(app.checkbox().props["aria-describedby"], /delete-project-directory.*delete-project-files-warning/);
  assert.match(text(app.node("AlertDialogDescription")), /项目、研究版本、任务、运行资源和报告将永久删除.*已发布成果及独立下游/);
  assert.match(text(app.node("AlertDialogContent")), /仅控制项目工作区.*永久删除.*项目源码、虚拟环境和 notebooks.*无法恢复.*不勾选仅保留项目文件夹.*仍删除项目记录/);
  assert.doesNotMatch(text(app.node("AlertDialogContent")), /已有研究版本、包和报告继续保留|归档/);
  assert.equal(app.requests.length, 0);
});

test("pending deletion disables options/cancel/action, suppresses close and Escape, then resets after success", async () => {
  const app = fixture();
  app.open();
  app.check(true);
  const pending = app.confirm();
  assert.deepEqual(Array.from(app.requests[0].args), ["one", true]);
  assert.equal(app.checkbox().props.disabled, true);
  assert.equal(app.node("AlertDialogCancel").props.disabled, true);
  assert.equal(app.node("AlertDialogAction").props.disabled, true);
  assert.equal(text(app.node("AlertDialogAction")), "删除中…");
  app.close();
  assert.equal(app.node("AlertDialog").props.open, true);
  assert.equal(app.checkbox().props.checked, true);
  const escape = { prevented: false, preventDefault() { this.prevented = true; } };
  app.node("AlertDialogContent").props.onEscapeKeyDown(escape);
  assert.equal(escape.prevented, true);
  await app.confirm();
  assert.equal(app.requests.length, 1, "a disabled action cannot launch another deletion");
  app.requests[0].resolve();
  await pending;
  app.render();
  assert.equal(app.node("AlertDialog").props.open, false);
  assertReset(app);
  app.open();
  assertReset(app);
});

for (const checked of [false, true]) {
  test(`API failure retains the open dialog and checked=${checked}, with a destructive Alert and retry`, async () => {
    const app = fixture();
    app.open();
    app.check(checked);
    const pending = app.confirm();
    app.requests[0].reject(new Error("项目文件夹删除失败"));
    await pending;
    app.render();
    assert.equal(app.node("AlertDialog").props.open, true);
    assert.equal(app.checkbox().props.checked, checked);
    assert.equal(app.checkbox().props.disabled, false);
    assert.equal(app.node("AlertDialogCancel").props.disabled, false);
    assert.equal(app.node("AlertDialogAction").props.disabled, false);
    const [alert] = elements(app.node("AlertDialogContent"), "Alert");
    assert.ok(alert, "the error must be displayed inside the still-open dialog");
    assert.equal(alert.props.variant, "destructive");
    assert.equal(text(alert), "项目文件夹删除失败");
    const retry = app.confirm();
    assert.equal(app.node("Alert"), undefined, "clear the old error while retrying");
    assert.deepEqual(Array.from(app.requests[1].args), ["one", checked]);
    app.requests[1].resolve();
    await retry;
    app.render();
    assert.equal(app.node("AlertDialog").props.open, false);
    assertReset(app);
  });
}

test("cancel resets the checkbox and error, and reopening for another project starts checked", async () => {
  const app = fixture();
  app.open();
  app.check(true);
  const pending = app.confirm();
  app.requests[0].reject(new Error("删除失败"));
  await pending;
  app.render();
  app.close();
  assert.equal(app.node("AlertDialog").props.open, false);
  assertReset(app);
  app.open(app.projects[1]);
  assert.equal(app.node("AlertDialog").props.open, true);
  assertReset(app);
  assert.equal(text(app.node("code")), app.projects[1].directory);
});

for (const checked of [true, false]) {
  test(`partial cleanup preserves original UUID and workspace choice ${checked} after polling removes the row`, async () => {
    const app = fixture();
    app.open();
    app.check(checked);
    const pending = app.confirm();
    app.state.projects = [{ ...project("new-uuid"), name: "one" }];
    app.requests[0].reject(new RequestError("运行资源清理失败", { status: 500, code: "project_cleanup_incomplete", reason: "运行资源清理失败", deleted: true, id: "one" }));
    await pending;
    app.render();
    assert.equal(app.node("AlertDialog").props.open, true);
    assert.equal(app.checkbox().props.checked, checked);
    assert.equal(app.checkbox().props.disabled, true, "a partially staged cleanup retains its original workspace option");
    assert.match(text(app.node("Alert")), /项目记录已删除.*重试清理原项目/);
    assert.equal(text(app.node("AlertDialogAction")), "重试清理");
    assert.equal(text(app.node("code")), app.projects[0].directory);
    const retry = app.confirm();
    assert.deepEqual(Array.from(app.requests[1].args), ["one", checked]);
    app.requests[1].resolve();
    await retry;
    app.render();
    assert.equal(app.node("AlertDialog").props.open, false);
    assert.equal(app.state.projects[0].id, "new-uuid");
  });
}

test("every delete-menu open clears an earlier error and choice", async () => {
  const app = fixture();
  app.open();
  app.check(true);
  const pending = app.confirm();
  app.requests[0].reject("unexpected failure");
  await pending;
  app.render();
  assert.equal(text(app.node("Alert")), "删除失败");
  app.open(app.projects[1]);
  assertReset(app);
  assert.equal(text(app.node("code")), app.projects[1].directory);
});
