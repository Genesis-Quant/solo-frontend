import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireProject = createRequire(join(root, "package.json"));
const ts = requireProject("typescript");
const React = requireProject("react");
const { renderToStaticMarkup } = requireProject("react-dom/server");
const { Link, MemoryRouter } = requireProject("react-router-dom");
const tablePath = join(root, "src/components/table/ProjectDataTable.tsx");
const pagePaths = ["ProjectsPage", "TasksPage", "StrategiesPage"].map((name) => join(root, `src/views/${name}.tsx`));

// This loader is local to this suite. Components, hooks, table features and router
// run normally during SSR; only API-backed stores and unopened dialogs are isolated.
function moduleLoader(overrides, globals = {}) {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
    }).outputText;
    vm.runInNewContext(compiled, {
      module,
      exports: module.exports,
      console,
      ...globals,
      require: (name) => {
        if (Object.hasOwn(overrides, name)) return overrides[name];
        if (!name.startsWith("@/") && !name.startsWith(".")) return requireProject(name);
        const candidate = name.startsWith("@/") ? join(root, "src", name.slice(2)) : resolve(dirname(filename), name);
        const resolved = [candidate, `${candidate}.ts`, `${candidate}.tsx`, join(candidate, "index.ts"), join(candidate, "index.tsx")].find((path) => existsSync(path));
        if (!resolved) throw new Error(`Cannot resolve ${name} from ${filename}`);
        return load(resolved);
      }
    }, { filename });
    return module.exports;
  }
  return load;
}

const project = {
  id: "project-one", name: "研究模型", description: "名称下面的说明", kind: "model", archived: false,
  schemeVersion: null, algoVersion: "1", updatedAt: "2026-10-02T00:00:00Z",
  versions: [1, 2].map((number) => ({
    id: `version-${number}`, number, note: `版本 ${number}`, submittedAt: "2026-10-02T00:00:00Z",
    status: "success", publishStatus: "unpublished", workflowId: number, duration: "10s", parameters: {}, dependencies: []
  }))
};
const strategy = {
  id: "strategy-one", name: "装配策略", status: "success", workflowId: 3,
  schemeVersion: null, createdAt: "2026-10-02T00:00:00Z", duration: "20s", error: "", reportPath: null,
  components: Object.fromEntries(["model", "optimize", "control", "execution"].map((stage) => [stage, { label: stage, version_id: null }])),
  forms: {}
};

function createHarness() {
  const blocked = () => { throw new Error("Navigation tests must not call an API or open a dialog"); };
  const research = { projects: [project], removeProject: blocked };
  const strategies = { records: [strategy], loaded: true, error: "", seedCreated: blocked };
  const overrides = {
    "@/store/research": { useResearchStore: (selector) => selector(research) },
    "@/store/strategy": { useStrategyStore: (selector) => selector(strategies), useStrategyPolling: () => {} },
    "@/store/pageMemory": { usePageState: (_scope, _key, initial) => React.useState(initial) },
    ...Object.fromEntries(["ProjectDialog", "TaskLogDialog", "StrategyDialog"].map((name) => [`@/components/modal/${name}`, { __esModule: true, default: blocked }]))
  };
  const load = moduleLoader(overrides);
  const tableUi = load(join(root, "src/ui/table.tsx"));
  const capturedRows = [];
  overrides["@/ui/table"] = {
    ...tableUi,
    TableRow: (props) => {
      if (typeof props.onClick === "function") capturedRows.push(props);
      return React.createElement(tableUi.TableRow, props);
    }
  };
  const { TooltipProvider } = load(join(root, "src/ui/tooltip.tsx"));
  return {
    load, research, strategies,
    render: (Component, props = {}) => {
      const start = capturedRows.length;
      const html = renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: ["/"] },
        React.createElement(TooltipProvider, null, React.createElement(Component, props))));
      return { html, rows: capturedRows.slice(start) };
    }
  };
}

const harness = createHarness();
function bodyLinks(html) {
  const body = html.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/)?.[1];
  assert.ok(body, "the real table body must render");
  return [...body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => ({
    href: match[1].match(/\bhref="([^"]*)"/)?.[1],
    title: match[1].match(/\btitle="([^"]*)"/)?.[1],
    tabIndex: match[1].match(/\btabindex="([^"]*)"/)?.[1],
    className: match[1].match(/\bclass="([^"]*)"/)?.[1] ?? "",
    text: match[2].replace(/<[^>]+>/g, "")
  }));
}

for (const [index, props, expected] of [
  [0, { kind: "model" }, [["研究模型", "/projects/project-one"]]],
  [1, {}, [["研究模型", "/projects/project-one?version=version-1"], ["研究模型", "/projects/project-one?version=version-2"], ["装配策略", "/strategies/strategy-one"]]],
  [2, {}, [["装配策略", "/strategies/strategy-one"]]]
]) {
  test(`${["ProjectsPage", "TasksPage", "StrategiesPage"][index]} SSR renders real, focusable name Links with the record href`, () => {
    const Page = harness.load(pagePaths[index]).default;
    const { html, rows } = harness.render(Page, props);
    const links = bodyLinks(html);
    assert.deepEqual(links.map(({ text, href }) => [text, href]).sort(), expected.slice().sort());
    assert.equal(rows.length, expected.length);
    for (const link of links) {
      assert.equal(link.title, link.text);
      assert.notEqual(link.tabIndex, "-1", "native name links remain keyboard reachable");
      assert.match(link.className, /block truncate/);
      assert.match(link.className, /font-medium/);
      assert.match(link.className, /group-hover:underline/);
      assert.match(link.className, /focus-visible:outline-2/);
    }
    for (const row of rows) {
      assert.equal(row.role, undefined, "rows retain table semantics instead of pretending to be links");
      assert.equal(row.tabIndex, undefined, "the name link is the row's navigation tab stop");
      assert.equal(row.onKeyDown, undefined, "keyboard activation is handled by the native link");
      assert.equal(row.onAuxClick, undefined, "native middle-click belongs to the actual name link");
    }
  });
}

function tableFixture() {
  const opened = [];
  const row = { id: 7, name: "直接表格记录" };
  const ProjectDataTable = harness.load(tablePath).default;
  const rendered = harness.render(ProjectDataTable, {
    columns: [{ id: "name", label: "名称", size: 280, sortKey: "name", value: (record) => record.name,
      cell: (record, href) => React.createElement(Link, { to: href, title: record.name }, record.name) }],
    rows: [row], rowHref: (record) => `/projects/${record.id}?version=chosen`, onOpen: (record) => opened.push(record),
    emptyMessage: "暂无记录", loading: false,
    pagination: { page: 1, pageSize: 20, total: 1, onPageChange: () => {}, onPageSizeChange: () => {} },
    search: { value: "", placeholder: "搜索", onChange: () => {} },
    sorting: { field: "name", order: "desc", onChange: () => {} }
  });
  assert.equal(rendered.rows.length, 1);
  return { ...rendered, handlers: rendered.rows[0], row, opened };
}

// Minimal event targets implement closest with ancestry. No window/document
// globals, browser injection, or fake React hooks.
function element(tag, attributes = {}, parent = null) {
  function matches(selector) {
    const [base, excluded] = selector.split(":not(");
    const parsed = base.match(/^([a-z]+)?(?:\[([\w-]+)(?:='([^']*)')?\])?$/);
    if (!parsed) throw new Error(`Unsupported event-fixture selector: ${selector}`);
    const [, expectedTag, attribute, value] = parsed;
    const matched = (!expectedTag || expectedTag === tag) && (!attribute || Object.hasOwn(attributes, attribute) && (value === undefined || attributes[attribute] === value));
    return matched && (!excluded || !matches(excluded.slice(0, -1)));
  }
  const node = { parent, closest: (selector) => {
    if (selector.split(",").some((part) => matches(part.trim()))) return node;
    return parent?.closest(selector) ?? null;
  } };
  return node;
}

function event(currentTarget, target = currentTarget, overrides = {}) {
  return { currentTarget, target, button: 0, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
    defaultPrevented: false, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...overrides };
}

const interactions = [
  ["a", { href: "/projects/7" }], ["button", {}], ["input", {}], ["select", {}], ["textarea", {}],
  ["label", {}], ["summary", {}], ["audio", { controls: "" }], ["video", { controls: "" }],
  ["div", { contenteditable: "true" }], ["div", { contenteditable: "" }], ["div", { contenteditable: "plaintext-only" }],
  ["div", { tabindex: "0" }], ["div", { tabindex: "-1" }],
  ...["button", "link", "checkbox", "radio", "switch", "combobox", "menuitem"].map((role) => ["div", { role }])
];

test("the actual table passes rowHref to the real Link cell, including numeric record ids", () => {
  const suite = tableFixture();
  assert.deepEqual(bodyLinks(suite.html).map(({ text, href }) => [text, href]), [[suite.row.name, "/projects/7?version=chosen"]]);
  assert.deepEqual(suite.opened, []);
});

test("ordinary primary clicks on the row, cells and noninteractive descendants open the original record", () => {
  const suite = tableFixture();
  const rowTarget = element("tr");
  const cell = element("td", {}, rowTarget);
  for (const target of [rowTarget, cell, element("span", {}, cell), element("span", { contenteditable: "false" }, cell)]) {
    const click = event(rowTarget, target);
    suite.handlers.onClick(click);
    assert.equal(click.prevented, false);
    assert.equal(click.stopped, false);
  }
  assert.equal(suite.opened.length, 4);
  assert.ok(suite.opened.every((record) => record === suite.row));
});

test("modified, nonprimary and already-handled clicks do not trigger row navigation or prevent native actions", () => {
  const suite = tableFixture();
  const rowTarget = element("tr");
  const cell = element("td", {}, rowTarget);
  for (const overrides of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { button: 1 }, { button: 2 }, { defaultPrevented: true }]) {
    const click = event(rowTarget, cell, overrides);
    suite.handlers.onClick(click);
    assert.equal(click.prevented, false);
    assert.equal(click.stopped, false);
  }
  assert.deepEqual(suite.opened, []);
  assert.equal(suite.handlers.onAuxClick, undefined);
});

test("links, controls, editable/focusable elements and nested icons never trigger the enclosing row", () => {
  const suite = tableFixture();
  const rowTarget = element("tr");
  const cell = element("td", {}, rowTarget);
  for (const [tag, attributes] of interactions) {
    const control = element(tag, attributes, cell);
    for (const target of [control, element("span", {}, control), element("svg", {}, control)]) {
      const click = event(rowTarget, target);
      suite.handlers.onClick(click);
      assert.equal(click.prevented, false);
      assert.equal(click.stopped, false);
    }
  }
  assert.deepEqual(suite.opened, []);
});

test("rows add no extra tab stop or keyboard activation alongside the native name link", () => {
  const suite = tableFixture();
  assert.equal(suite.handlers.tabIndex, undefined);
  assert.equal(suite.handlers.onKeyDown, undefined);
  assert.equal(suite.handlers.role, undefined);
  const [link] = bodyLinks(suite.html);
  assert.equal(link.href, "/projects/7?version=chosen");
  assert.notEqual(link.tabIndex, "-1");
  const rowTarget = element("tr");
  const click = event(rowTarget, element("a", { href: link.href }, rowTarget), { detail: 0 });
  suite.handlers.onClick(click);
  assert.equal(click.prevented, false, "keyboard-generated native link clicks are not cancelled");
  assert.deepEqual(suite.opened, [], "the row does not duplicate native Link navigation");
});

function findElements(tree, predicate) {
  const matches = [];
  React.Children.forEach(tree, (node) => {
    if (!React.isValidElement(node)) return;
    if (predicate(node)) matches.push(node);
    matches.push(...findElements(node.props.children, predicate));
  });
  return matches;
}

for (const [index, props] of [[0, { kind: "model" }], [1, {}], [2, {}]]) {
  test(`${["ProjectsPage", "TasksPage", "StrategiesPage"][index]} keeps real TanStack cell component types across polling parent rerenders`, () => {
    const app = createHarness();
    const Page = app.load(pagePaths[index]).default;
    const Table = app.load(tablePath).default;
    const snapshots = [];
    // Render-phase updates retain real React hooks without requiring a DOM.
    // Inline page/table calls keep their hooks in the probe's rerendered fiber.
    function Probe() {
      const [pass, setPass] = React.useState(0);
      app.research.projects = [{ ...project, name: `${project.name} ${pass}` }];
      app.strategies.records = [{ ...strategy, name: `${strategy.name} ${pass}` }];
      const [table] = findElements(Page(props), (node) => node.type === Table);
      assert.ok(table);
      const tree = Table(table.props);
      const cells = findElements(tree, (node) => !!node.props.cell).map((node) => ({
        id: node.props.cell.id,
        component: node.type(node.props).type,
        name: node.props.cell.row.original.name
      }));
      snapshots.push({ rowHref: table.props.rowHref, columns: table.props.columns, cells });
      if (pass < 2) setPass(pass + 1);
      return tree;
    }
    app.render(Probe);
    assert.equal(snapshots.length, 3);
    assert.ok(snapshots[0].cells.length > 0);
    for (const snapshot of snapshots.slice(1)) {
      assert.deepEqual(snapshot.cells.map(({ id }) => id), snapshots[0].cells.map(({ id }) => id));
      snapshot.cells.forEach((cell, cellIndex) => {
        assert.equal(typeof cell.component, "function", "FlexRender creates a real React component element");
        assert.equal(cell.component, snapshots[0].cells[cellIndex].component, `${cell.id} must not acquire a new component type`);
        assert.notEqual(cell.name, snapshots[0].cells[cellIndex].name, "stable renderers still receive refreshed data");
      });
      assert.equal(snapshot.rowHref, snapshots[0].rowHref);
      assert.equal(snapshot.columns, snapshots[0].columns);
    }
  });
}

test("project scope changes use distinct table keys even with identical remembered queries", () => {
  const app = createHarness();
  const Page = app.load(pagePaths[0]).default;
  const Table = app.load(tablePath).default;
  const tables = [];
  function Probe() {
    const [pass, setPass] = React.useState(0);
    const [table] = findElements(Page({ kind: pass ? "factor" : "model" }), (node) => node.type === Table);
    tables.push(table);
    if (!pass) setPass(1);
    return null;
  }
  app.render(Probe);
  assert.equal(tables.length, 2);
  assert.equal(tables[0].props.search.value, tables[1].props.search.value);
  assert.equal(tables[0].key, "projects:model");
  assert.equal(tables[1].key, "projects:factor");
});

test("StrategiesPage skeletons stop on cold errors and stay off for successful empty caches", () => {
  const app = createHarness();
  const Page = app.load(pagePaths[2]).default;
  const Table = app.load(tablePath).default;
  app.strategies.records = [];
  function Probe() {
    const [table] = findElements(Page(), (node) => node.type === Table);
    return React.createElement("output", { "data-loading": String(table.props.loading) });
  }
  for (const [loaded, error, expected] of [[false, "", true], [false, "offline", false], [true, "", false], [true, "offline", false]]) {
    Object.assign(app.strategies, { loaded, error });
    assert.equal(app.render(Probe).html, `<output data-loading="${expected}"></output>`);
  }
});

// Keep React state/ref/memo hooks and TanStack real. Only passive-effect timing
// and the table's window timers are driven explicitly inside an SSR rerender probe.
function searchFixture(steps, { initial = "", echo = true } = {}) {
  const effects = [], slots = new Set(), timers = new Map(), changes = [];
  let now = 0, nextTimer = 0, step = 0, input, clearButton;
  const window = {
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  const search = { value: initial, placeholder: "search-probe", onChange(value) {
    changes.push(value);
    if (echo) search.value = value;
  } };
  const load = moduleLoader({ react: { ...React, useEffect(callback, deps) {
    const ref = React.useRef({ deps: null, cleanup: undefined });
    const slot = ref.current;
    slots.add(slot);
    if (!slot.deps || deps.some((value, index) => !Object.is(value, slot.deps[index]))) {
      slot.deps = deps;
      effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); });
    }
  } } }, { window });
  const Table = load(tablePath).default;
  const props = {
    columns: [], rows: [], loading: false, rowHref: () => "", onOpen: () => {}, emptyMessage: "empty", search,
    pagination: { page: 1, pageSize: 20, total: 0, onPageChange: () => {}, onPageSizeChange: () => {} },
    sorting: { field: "name", order: "desc", onChange: () => {} }
  };
  const fixture = {
    changes, timers,
    get draft() { return input.props.value; },
    get committed() { return search.value; },
    type(value) { input.props.onChange({ target: { value } }); },
    clear() { assert.ok(clearButton); clearButton.props.onClick(); },
    external(value) { search.value = value; },
    advance(duration) {
      now += duration;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) { timers.delete(id); timer.callback(); }
      }
    },
    close() { for (const slot of slots) { slot.cleanup?.(); slot.cleanup = undefined; } }
  };
  function Probe() {
    const [, rerender] = React.useState(0);
    const tree = Table(props);
    [input] = findElements(tree, (node) => node.props.placeholder === search.placeholder);
    [clearButton] = findElements(tree, (node) => node.props["aria-label"] === "清空搜索");
    assert.ok(input);
    if (effects.length) {
      effects.splice(0).forEach((effect) => effect());
      rerender((pass) => pass + 1);
    } else if (step < steps.length) {
      steps[step++](fixture);
      rerender((pass) => pass + 1);
    }
    return null;
  }
  try {
    renderToStaticMarkup(React.createElement(Probe));
    assert.equal(step, steps.length);
    return fixture;
  } finally { fixture.close(); }
}

test("normalized search echoes preserve the space before typing the next word", () => {
  searchFixture([
    (app) => app.type("  alpha "),
    (app) => { app.advance(299); assert.deepEqual(app.changes, []); },
    (app) => app.advance(1),
    (app) => { assert.equal(app.draft, "  alpha "); assert.equal(app.committed, "alpha"); app.type(`${app.draft}beta `); },
    (app) => app.advance(300),
    (app) => { assert.equal(app.draft, "  alpha beta "); assert.deepEqual(app.changes, ["alpha", "alpha beta"]); assert.equal(app.timers.size, 0); }
  ]);
});

test("an own echo arriving after newer typing does not overwrite that draft", () => {
  searchFixture([
    (app) => app.type("alpha "),
    (app) => app.advance(300),
    (app) => app.type("alpha beta "),
    (app) => app.external("alpha"),
    (app) => { assert.equal(app.draft, "alpha beta "); app.advance(300); },
    (app) => { assert.deepEqual(app.changes, ["alpha", "alpha beta"]); app.external("alpha beta"); },
    (app) => { assert.equal(app.draft, "alpha beta "); assert.equal(app.timers.size, 0); }
  ], { echo: false });
});

test("search debounce commits only the latest draft and ignores polling rerenders", () => {
  searchFixture([
    (app) => app.type("alpha"),
    (app) => { app.advance(200); app.type("alpha beta"); },
    (app) => { app.advance(200); assert.deepEqual(app.changes, []); },
    (app) => { app.advance(99); assert.deepEqual(app.changes, []); },
    (app) => app.advance(1),
    (app) => { assert.deepEqual(app.changes, ["alpha beta"]); app.advance(5000); assert.equal(app.timers.size, 0); }
  ]);
});

test("genuine external values replace local drafts and cancel obsolete debounce work", () => {
  searchFixture([
    (app) => app.type("local pending "),
    (app) => { app.advance(200); app.external("external query"); },
    (app) => { assert.equal(app.draft, "external query"); app.advance(1000); assert.deepEqual(app.changes, []); },
    (app) => app.type("new pending "),
    (app) => app.external(""),
    (app) => { assert.equal(app.draft, ""); app.advance(1000); assert.deepEqual(app.changes, []); assert.equal(app.timers.size, 0); }
  ], { initial: "saved" });
});

test("external search updates win over a different outstanding local commit", () => {
  searchFixture([
    (app) => app.type("local "),
    (app) => app.advance(300),
    (app) => app.external("remote"),
    (app) => { assert.equal(app.draft, "remote"); app.advance(1000); assert.deepEqual(app.changes, ["local"]); }
  ], { echo: false });
});

test("clearing search commits immediately and cancels any pending draft timer", () => {
  searchFixture([
    (app) => app.type("pending "),
    (app) => { app.advance(200); app.clear(); assert.deepEqual(app.changes, [""]); },
    (app) => { assert.equal(app.draft, ""); app.advance(1000); assert.deepEqual(app.changes, [""]); assert.equal(app.timers.size, 0); }
  ], { initial: "saved" });
});

test("an echoed clear does not erase typing that happened after the clear", () => {
  searchFixture([
    (app) => app.clear(),
    (app) => app.type("next "),
    (app) => app.external(""),
    (app) => { assert.equal(app.draft, "next "); app.advance(300); },
    (app) => { assert.deepEqual(app.changes, ["", "next"]); app.external("next"); },
    (app) => { assert.equal(app.draft, "next "); assert.equal(app.timers.size, 0); }
  ], { initial: "saved", echo: false });
});

test("whitespace-only drafts and already normalized queries do not cause redundant commits", () => {
  searchFixture([
    (app) => app.type("   "),
    (app) => { app.advance(1000); assert.equal(app.draft, "   "); assert.deepEqual(app.changes, []); app.type("alpha"); },
    (app) => app.advance(300),
    (app) => app.type("alpha "),
    (app) => { app.advance(1000); assert.equal(app.draft, "alpha "); assert.deepEqual(app.changes, ["alpha"]); }
  ]);
});

test("table cleanup cancels an uncommitted draft when leaving a scope", () => {
  const app = searchFixture([
    (app) => app.type("abandoned "),
    (app) => assert.equal(app.timers.size, 1)
  ]);
  assert.equal(app.timers.size, 0);
  app.advance(1000);
  assert.deepEqual(app.changes, []);
  searchFixture([(next) => { assert.equal(next.draft, "saved elsewhere"); assert.equal(next.timers.size, 0); }], { initial: "saved elsewhere" });
});

test("the four edited TSX modules type-check their generic columns, rowHref and page props", () => {
  const configPath = join(root, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const program = ts.createProgram({ rootNames: [tablePath, ...pagePaths], options: { ...parsed.options, incremental: false, noEmit: true } });
  const diagnostics = [tablePath, ...pagePaths].flatMap((filename) => {
    const source = program.getSourceFile(filename);
    assert.ok(source, `TypeScript must load ${filename}`);
    return [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)];
  });
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (filename) => filename, getCurrentDirectory: () => root, getNewLine: () => "\n"
  }));
});
