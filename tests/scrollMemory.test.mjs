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
const { MemoryRouter } = require("react-router-dom");
const path = fileURLToPath(new URL("../src/hooks/useScrollMemory.ts", import.meta.url));
const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
  fileName: path,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

function fixture(saved = 900) {
  const list = "/projects/factor";
  const slots = [], remembered = [], saves = [];
  const timers = new Map(), windowListeners = new Map(), documentListeners = new Map();
  const memory = { scroll: { [list]: saved } };
  let cursor = 0, effects = [], nextId = 1, hook;
  const saveScroll = (pathname, top) => { memory.scroll[pathname] = top; saves.push({ pathname, top }); };
  const store = (selector) => selector({ ...memory, saveScroll });
  store.getState = () => memory;
  const element = { clientHeight: 744, scrollHeight: 508, value: 0, writes: [] };
  Object.defineProperty(element, "scrollTop", {
    get() { return this.value; },
    set(top) {
      this.value = Math.max(0, Math.min(top, this.scrollHeight - this.clientHeight));
      this.writes.push(this.value);
    }
  });
  function events(listeners) {
    return {
      addEventListener(type, callback) { listeners.set(type, callback); },
      removeEventListener(type, callback) { if (listeners.get(type) === callback) listeners.delete(type); }
    };
  }
  const document = { hidden: false, ...events(documentListeners) };
  const react = {
    useRef(initial) {
      const index = cursor++;
      slots[index] ??= { current: initial };
      return slots[index];
    },
    useCallback(callback, deps) {
      const slot = slots[cursor++] ??= {};
      if (!slot.deps || deps.some((value, index) => !Object.is(value, slot.deps[index]))) {
        slot.deps = deps; slot.callback = callback;
      }
      return slot.callback;
    },
    useLayoutEffect(callback, deps) {
      const slot = slots[cursor++] ??= {};
      if (!slot.deps || deps.some((value, index) => !Object.is(value, slot.deps[index]))) {
        slot.deps = deps; effects.push({ callback, slot });
      }
    }
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, document,
    require(name) {
      if (name === "react") return react;
      if (name === "@/store/pageMemory") return {
        usePageMemory: store, isPrimaryPage: (pathname) => pathname === list || pathname === "/tasks" || pathname === "/strategies",
        rememberPrimaryPage: (pathname) => remembered.push(pathname)
      };
      throw new Error(`Unexpected dependency ${name}`);
    },
    window: {
      ...events(windowListeners),
      setTimeout(callback) { const id = nextId++; timers.set(id, callback); return id; },
      clearTimeout(id) { timers.delete(id); }
    }
  }, { filename: path });
  function render(pathname = list, ready = true) {
    cursor = 0; effects = [];
    hook = module.exports.useScrollMemory(pathname, ready);
    hook.contentRef.current = element;
    for (const { slot } of effects) slot.cleanup?.();
    for (const { callback, slot } of effects) slot.cleanup = callback();
  }
  function scroll(top) { element.value = top; hook.onScroll({ currentTarget: element }); }
  return {
    list, memory, element, timers, remembered, saves, windowListeners, documentListeners, render, scroll,
    pagehide() { windowListeners.get("pagehide")?.(); },
    visibility(hidden) { document.hidden = hidden; documentListeners.get("visibilitychange")?.(); },
    flushTimers() {
      const callbacks = [...timers.values()]; timers.clear();
      for (const callback of callbacks) callback();
    },
    close() { slots.forEach((slot) => slot.cleanup?.()); }
  };
}

test("initial loading cannot replace saved position; ready content restores once", () => {
  const app = fixture();
  try {
    app.render(app.list, false);
    assert.equal(app.element.writes.length, 0);
    app.scroll(0); app.flushTimers();
    assert.equal(app.memory.scroll[app.list], 900);
    app.element.scrollHeight = 1900;
    app.render(app.list, true);
    assert.equal(app.element.scrollTop, 900);
    app.scroll(900); app.flushTimers();
    assert.equal(app.memory.scroll[app.list], 900);
    const writes = app.element.writes.length;
    app.render(app.list, true);
    assert.equal(app.element.writes.length, writes);
  } finally { app.close(); }
});

test("same-route loading or error recovery restores the last pending user position", () => {
  const app = fixture();
  try {
    app.element.scrollHeight = 1900; app.render(); app.scroll(700);
    app.element.scrollHeight = app.element.clientHeight;
    app.element.scrollTop = 0;
    app.render(app.list, false);
    app.scroll(0); app.flushTimers();
    assert.equal(app.memory.scroll[app.list], 700);
    app.element.scrollHeight = 1900;
    app.render(app.list, true);
    assert.equal(app.element.scrollTop, 700);
    app.element.scrollHeight = app.element.clientHeight;
    app.element.scrollTop = 0;
    app.render(app.list, false);
    app.element.scrollHeight = 1900;
    app.render(app.list, true);
    assert.equal(app.element.scrollTop, 700);
  } finally { app.close(); }
});

test("ready shorter content clamps once, saves the result and never jumps on later growth", () => {
  const app = fixture();
  try {
    app.element.scrollHeight = app.element.clientHeight + 200;
    app.render();
    assert.equal(app.element.scrollTop, 200);
    assert.equal(app.memory.scroll[app.list], 200);
    app.scroll(120); app.flushTimers();
    assert.equal(app.memory.scroll[app.list], 120);
    const writes = app.element.writes.length;
    app.element.scrollHeight = 1900;
    app.render();
    assert.equal(app.element.scrollTop, 120);
    assert.equal(app.element.writes.length, writes);
  } finally { app.close(); }
});

test("an empty ready list settles at zero instead of leaving a stale restore target", () => {
  const app = fixture();
  try {
    app.render();
    assert.equal(app.element.scrollTop, 0);
    assert.equal(app.memory.scroll[app.list], 0);
    app.element.scrollHeight = 1900; app.render();
    assert.equal(app.element.scrollTop, 0);
    app.scroll(100); app.flushTimers();
    assert.equal(app.memory.scroll[app.list], 100);
  } finally { app.close(); }
});

test("ordinary scrolling is debounced without frame suppression or input listeners", () => {
  const app = fixture();
  try {
    app.element.scrollHeight = 1900; app.render();
    app.scroll(500); app.scroll(550);
    assert.equal(app.timers.size, 1);
    assert.equal(app.memory.scroll[app.list], 900);
    app.flushTimers();
    assert.equal(app.memory.scroll[app.list], 550);
  } finally { app.close(); }
});

test("leaving a page flushes its pending position before restoring another", () => {
  const app = fixture();
  try {
    app.element.scrollHeight = 1900; app.render(); app.scroll(550);
    app.render("/projects/project-id", true);
    assert.equal(app.memory.scroll[app.list], 550);
    assert.equal(app.element.scrollTop, 0);
    assert.equal(app.timers.size, 0);
    app.render(app.list, true);
    assert.equal(app.element.scrollTop, 550);
  } finally { app.close(); }
});

test("document exit flushes pending scroll without a React unmount", () => {
  const app = fixture();
  try {
    app.element.scrollHeight = 1900; app.render(); app.scroll(600);
    app.pagehide();
    assert.equal(app.memory.scroll[app.list], 600);
    assert.equal(app.timers.size, 0);
    app.scroll(650); app.visibility(false);
    assert.equal(app.memory.scroll[app.list], 600);
    app.visibility(true);
    assert.equal(app.memory.scroll[app.list], 650);
    assert.equal(app.timers.size, 0);
  } finally { app.close(); }
});

test("cleanup flushes pending scroll and removes document lifecycle listeners", () => {
  const app = fixture();
  app.element.scrollHeight = 1900; app.render(); app.scroll(600);
  app.close();
  assert.equal(app.memory.scroll[app.list], 600);
  assert.equal(app.timers.size, 0);
  assert.equal(app.windowListeners.size, 0);
  assert.equal(app.documentListeners.size, 0);
});

test("page scopes restore their own position and detail scrolling is not saved", () => {
  const app = fixture();
  try {
    app.memory.scroll["/tasks"] = 300;
    app.element.scrollHeight = 1900; app.render("/tasks", true);
    assert.equal(app.element.scrollTop, 300);
    app.render("/strategies/strategy-id", true); app.scroll(250); app.flushTimers();
    assert.equal(app.memory.scroll["/strategies/strategy-id"], undefined);
    app.render(app.list, true);
    assert.equal(app.element.scrollTop, 900);
  } finally { app.close(); }
});

// Render the real Workbench/router with API stores and leaf pages isolated. This
// exercises readiness props instead of locking the test to a source-code spelling.
const appPath = fileURLToPath(new URL("../src/App.tsx", import.meta.url));
const appCompiled = ts.transpileModule(readFileSync(appPath, "utf8"), {
  fileName: appPath,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
}).outputText;
function workbenchFixture(strategyStore) {
  const research = { loading: false, error: "", loadProjects() {} };
  const strategies = { loaded: false, records: [], error: "" };
  const leaf = ({ children }) => React.createElement("div", null, children);
  const overrides = {
    "@/store/research": { useResearchStore: (selector) => selector(research) },
    "@/store/strategy": { useStrategyStore: (selector) => selector(strategyStore ? strategyStore.getState() : strategies) },
    "@/store/pageMemory": { lastPrimaryPage: () => "/projects/factor" },
    "@/types/research": { projectKinds: ["factor", "model", "optimize", "control", "execution"] },
    "@/layout/AppLayout": { default: ({ contentReady, children }) => React.createElement("main", { "data-ready": String(contentReady) }, children) },
    "@/ui/alert": { Alert: leaf, AlertDescription: leaf },
    "@/ui/button": { Button: leaf },
    "@/ui/skeleton": { Skeleton: leaf },
    "motion/react": { MotionConfig: leaf }
  };
  for (const name of ["ProjectsPage", "ProjectPage", "TasksPage", "StrategiesPage", "StrategyPage", "EmbeddedReportPage"]) {
    overrides[`@/views/${name}`] = { default: () => React.createElement("section", { "data-page": name }) };
  }
  const module = { exports: {} };
  vm.runInNewContext(appCompiled, {
    module, exports: module.exports,
    require: (name) => Object.hasOwn(overrides, name) ? overrides[name] : require(name)
  }, { filename: appPath });
  return {
    research, strategies,
    render(pathname) {
      const html = renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: [pathname] }, React.createElement(module.exports.default)));
      assert.match(html, /data-ready="(?:true|false)"/);
      return { ready: html.includes('data-ready="true"'), html };
    }
  };
}

test("Workbench waits for strategy data on strategy/task lists but still mounts those pages", () => {
  const app = workbenchFixture();
  for (const [path, page] of [["/strategies", "StrategiesPage"], ["/tasks", "TasksPage"]]) {
    const rendered = app.render(path);
    assert.equal(rendered.ready, false);
    assert.ok(rendered.html.includes(`data-page="${page}"`), "the page must mount so its polling can load strategies");
  }
  assert.equal(app.render("/projects/factor").ready, true);
  assert.equal(app.render("/projects/project-id").ready, true);
  assert.equal(app.render("/strategies/strategy-id").ready, true);
  app.strategies.loaded = true;
  assert.equal(app.render("/strategies").ready, true);
  assert.equal(app.render("/tasks").ready, true);
  app.strategies.error = "background refresh failed";
  assert.equal(app.render("/strategies").ready, true, "cached content remains ready after a refresh failure");
});

test("Workbench research placeholders remain unavailable until the real route returns", () => {
  const app = workbenchFixture();
  app.strategies.loaded = true;
  app.research.loading = true;
  assert.equal(app.render("/tasks").ready, false);
  app.research.loading = false; app.research.error = "offline";
  assert.equal(app.render("/tasks").ready, false);
  app.research.error = "";
  assert.equal(app.render("/tasks").ready, true);
});

test("Workbench preserves a definite-height route container for desktop project panes", () => {
  const page = workbenchFixture();
  page.strategies.loaded = true;
  for (const path of ["/projects/project-id", "/projects/factor", "/strategies", "/tasks"]) {
    const { html } = page.render(path);
    assert.match(html, /<div class="page-enter h-full">/);
  }
});

function liveStrategyStore() {
  const sourcePath = fileURLToPath(new URL("../src/store/strategy.ts", import.meta.url));
  const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
    fileName: sourcePath,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const requests = [];
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, Error,
    require(name) {
      if (name === "@/assets/lib/request") return { client: {
        get() { return new Promise((resolve, reject) => requests.push({ resolve, reject })); }
      } };
      if (name === "@/types/strategy") return {
        strategyActive: (status) => ["building", "queued", "running"].includes(status)
      };
      return require(name);
    }
  }, { filename: sourcePath });
  return { store: module.exports.useStrategyStore, requests };
}

test("cold strategy failure preserves scroll until actual successful content arrives", async () => {
  for (const route of ["/strategies", "/tasks"]) {
    const { store, requests } = liveStrategyStore();
    const page = workbenchFixture(store);
    const app = fixture();
    try {
      app.memory.scroll[route] = 600;
      app.render(route, page.render(route).ready);
      const first = store.getState().load();
      requests[0].reject(new Error("offline"));
      await first;
      assert.equal(store.getState().loaded, false);
      assert.equal(page.render(route).ready, false);
      app.render(route, page.render(route).ready);
      app.scroll(0); app.flushTimers();
      assert.equal(app.memory.scroll[route], 600);
      assert.equal(app.element.writes.length, 0);
      const retry = store.getState().load();
      requests[1].resolve(Array.from({ length: 50 }, (_, index) => ({ id: String(index), status: "success" })));
      await retry;
      app.element.scrollHeight = 1900;
      app.render(route, page.render(route).ready);
      assert.equal(app.element.scrollTop, 600);
      assert.equal(app.memory.scroll[route], 600);
      const writes = app.element.writes.length;
      const refresh = store.getState().load();
      requests[2].reject(new Error("background offline"));
      await refresh;
      assert.equal(page.render(route).ready, true);
      app.render(route, page.render(route).ready);
      assert.equal(app.element.writes.length, writes);
    } finally { app.close(); }
  }
});

test("a successful empty strategy list remains ready after a failed refresh", async () => {
  const { store, requests } = liveStrategyStore();
  const page = workbenchFixture(store);
  const initial = store.getState().load();
  requests[0].resolve([]);
  await initial;
  assert.equal(page.render("/strategies").ready, true);
  const refresh = store.getState().load();
  requests[1].reject(new Error("offline"));
  await refresh;
  assert.equal(page.render("/strategies").ready, true);
});

test("strategy readiness prevents early clamping and later growth does not re-restore", () => {
  const page = workbenchFixture();
  const app = fixture();
  try {
    app.memory.scroll["/strategies"] = 600;
    app.render("/strategies", page.render("/strategies").ready);
    assert.equal(app.element.writes.length, 0);
    app.element.scrollHeight = 1900;
    page.strategies.loaded = true;
    app.render("/strategies", page.render("/strategies").ready);
    assert.equal(app.element.scrollTop, 600);
    app.scroll(450); app.flushTimers();
    app.element.scrollHeight = 2200;
    app.render("/strategies", page.render("/strategies").ready);
    assert.equal(app.element.scrollTop, 450);
  } finally { app.close(); }
});
