import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

import { appendTaskLog, parseTaskLog, shouldResetTerminalTaskLog } from "../src/assets/lib/taskLogs.ts";
import { taskLogScopes } from "../src/types/task.ts";

test("task logs keep the complete view as default-compatible scope and expose Worker output", () => {
  assert.deepEqual(taskLogScopes, ["full", "worker"]);
});

test("worker log pages preserve a blank output line at page boundaries", () => {
  const message = appendTaskLog(
    appendTaskLog("first", "\n", true),
    "third",
    true
  );

  assert.deepEqual(
    parseTaskLog(message).map((line) => line.message),
    ["first", "", "third"]
  );
});

test("terminal Worker logs keep their raw cursor instead of rescanning from the start", () => {
  assert.equal(shouldResetTerminalTaskLog("full", true), true);
  assert.equal(shouldResetTerminalTaskLog("worker", true), false);
  assert.equal(shouldResetTerminalTaskLog("worker", false), false);
});


function logFixture(terminal = false) {
  const require = createRequire(import.meta.url), React = require("react"), ts = require("typescript");
  const slots = [], requests = [], timers = new Map();
  let cursor = 0, effects = [], tree, queued = false, closed = false, timerId = 0;
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
        slot.deps = deps; effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); });
      }
    },
    useMemo(factory, deps) {
      const slot = slots[cursor++] ??= {};
      if (!slot.deps || deps.some((value, index) => !Object.is(value, slot.deps[index]))) { slot.deps = deps; slot.value = factory(); }
      return slot.value;
    },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); }
  };
  hooks.useLayoutEffect = hooks.useEffect;
  const workflow = { state: terminal ? "SUCCESS" : "RUNNING_EXECUTION", tasks: [{ task_instance_id: 2, state: terminal ? "SUCCESS" : "RUNNING_EXECUTION", host: "worker", name: "report" }] };
  const api = {
    tasks: async () => workflow,
    logs(...args) { return new Promise((resolve, reject) => requests.push({ kind: "page", args, resolve, reject })); },
    downloadLog(...args) { return new Promise((resolve, reject) => requests.push({ kind: "download", args, resolve, reject })); }
  };
  const filename = fileURLToPath(new URL("../src/components/panel/TaskLogPanel.tsx", import.meta.url));
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, Error,
    window: { setInterval(callback) { timers.set(++timerId, callback); return timerId; }, clearInterval(id) { timers.delete(id); } },
    require(name) {
      if (name === "react") return hooks;
      if (name === "@/assets/lib/taskLogs") return { appendTaskLog, shouldResetTerminalTaskLog };
      if (name === "@/assets/lib/taskLogApi") return { createTaskLogApi: () => api, formatDuration: () => "1s" };
      if (name === "@/assets/lib/utils") return { cn: (...values) => values.filter(Boolean).join(" ") };
      if (name === "@/types/workflow") return { terminalStates: new Set(["SUCCESS"]) };
      if (name.startsWith("@/ui/")) return new Proxy({}, { get: (_target, key) => key });
      if (name.startsWith("~icons/") || name === "@/components/panel/TaskLogViewer") return { __esModule: true, default: name };
      if (name === "@/components/bar/AppPagination") return { AppPagination: "AppPagination" };
      if (name === "@/components/badge/SchedulerState") return { __esModule: true, default: "SchedulerState" };
      if (name.startsWith("@/")) throw new Error(`Unexpected log dependency: ${name}`);
      return require(name);
    }
  }, { filename });
  function schedule() {
    if (queued || closed) return;
    queued = true; queueMicrotask(() => { queued = false; if (!closed) render(); });
  }
  function render() {
    cursor = 0; effects = [];
    tree = module.exports.default({ apiBase: "/test/logs", workflowInstanceId: 1, taskInstanceId: 2 });
    effects.splice(0).forEach((effect) => effect());
  }
  function find(node, name) {
    if (Array.isArray(node)) return node.map((child) => find(child, name)).find(Boolean);
    if (!React.isValidElement(node)) return undefined;
    return node.type === name ? node : find(node.props.children, name);
  }
  render();
  return { requests, message: () => find(tree, "@/components/panel/TaskLogViewer").props.message,
    scope(value) { find(tree, "Tabs").props.onValueChange(value); },
    poll() { return timers.values().next().value(); },
    settle: async () => { for (let index = 0; index < 5; index++) await new Promise(setImmediate); },
    close() { closed = true; slots.forEach((slot) => slot.cleanup?.()); }
  };
}

test("received log pages display before later pages finish, and remain visible after a later error", async () => {
  const app = logFixture();
  try {
    await app.settle();
    assert.equal(app.requests[0].kind, "page");
    app.requests[0].resolve({ message: "first page", has_more: true, next_line_num: 1 });
    await app.settle();
    assert.equal(app.requests.length, 2);
    assert.equal(app.message(), "first page");
    assert.equal(app.requests[1].args[1], 1);
    app.requests[1].reject(new Error("second page unavailable"));
    await app.settle();
    assert.equal(app.message(), "first page");
  } finally { app.close(); }
});

test("terminal full logs still use the complete download rather than paginated requests", async () => {
  const app = logFixture(true);
  try {
    await app.settle();
    assert.equal(app.requests.length, 1);
    assert.equal(app.requests[0].kind, "download");
    app.requests[0].resolve("complete log");
    await app.settle();
    assert.equal(app.message(), "complete log");
  } finally { app.close(); }
});

test("full → Worker → full ignores superseded pages and preserves the new generation's cursors", async () => {
  const app = logFixture();
  try {
    await app.settle();
    app.requests[0].resolve({ message: "first page", has_more: true, next_line_num: 1, next_cursor: "old-page" });
    await app.settle();
    const oldPage = app.requests[1];
    app.scope("worker"); await app.settle();
    const workerPage = app.requests[2];
    app.scope("full"); await app.settle();
    assert.equal(app.requests.length, 4, "returning to full starts a new load even while an old full request is pending");
    assert.equal(app.requests[3].args[1], 0);
    app.requests[3].resolve({ message: "first page\nsecond page", has_more: false, next_line_num: 2, next_cursor: "current-page" });
    await app.settle();
    oldPage.resolve({ message: "second page", has_more: true, next_line_num: 99, next_cursor: "stale-page" });
    workerPage.reject(new Error("superseded Worker request"));
    await app.settle();
    assert.equal(app.requests.length, 4, "a stale has_more response must not start another page");
    assert.equal(app.message(), "first page\nsecond page");
    const polling = app.poll(); await app.settle();
    assert.equal(app.requests[4].args[1], 2);
    assert.equal(app.requests[4].args[4], "current-page");
    app.requests[4].resolve({ message: "third page", has_more: false, next_line_num: 3, next_cursor: "next-page" });
    await polling; await app.settle();
    assert.equal(app.message(), "first page\nsecond page\nthird page");
  } finally { app.close(); }
});

test("a superseded terminal download cannot overwrite the latest full log", async () => {
  const app = logFixture(true);
  try {
    await app.settle();
    app.scope("worker"); await app.settle();
    app.scope("full"); await app.settle();
    assert.deepEqual(app.requests.map((request) => request.kind), ["download", "page", "download"]);
    app.requests[2].resolve("latest complete log"); await app.settle();
    app.requests[0].resolve("obsolete complete log");
    app.requests[1].resolve({ message: "obsolete Worker log", has_more: false, next_line_num: 99, next_cursor: "obsolete" });
    await app.settle();
    assert.equal(app.message(), "latest complete log");
  } finally { app.close(); }
});

test("ANSI-colored Loguru output keeps its level and Python source", () => {
  const line = parseTaskLog("\u001b[32m2026-09-25 20:56:05\u001b[0m [ INFO ] session.py | create_session: 166行| connected")[0];
  assert.equal(line.level, "INFO");
  assert.equal(line.file, "session.py");
  assert.equal(line.sourceLine, 166);
  assert.equal(line.message, "connected");
});
