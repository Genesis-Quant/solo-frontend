import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const requireProject = createRequire(new URL("../package.json", import.meta.url));
const ts = requireProject("typescript");
const realCreate = requireProject("zustand").create;
const sourcePath = fileURLToPath(new URL("../src/store/strategy.ts", import.meta.url));
const compiledSource = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
  fileName: sourcePath,
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS
  }
}).outputText;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function record(id, status = "running") {
  const stages = ["model", "optimize", "control", "execution"];
  return {
    id,
    name: `strategy-${id}`,
    components: Object.fromEntries(stages.map((stage) => [stage, { label: stage, version_id: null }])),
    forms: Object.fromEntries(stages.map((stage) => [stage, {}])),
    status,
    error: "",
    workflowId: 1,
    schemeVersion: "1.0",
    createdAt: "2026-10-01T00:00:00Z",
    duration: "10s",
    reportPath: status === "success"
      ? `${id}/report`
      : null
  };
}

function fakeClock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  function schedule(callback, delay, repeat) {
    const id = ++nextId;
    timers.set(id, { callback, delay, due: now + delay, repeat });
    return id;
  }
  return {
    timers,
    setTimeout: (callback, delay) => schedule(callback, delay, false),
    clearTimeout: (id) => timers.delete(id),
    // Keep intervals available so replacing serial polling with an interval fails behavior assertions.
    setInterval: (callback, delay) => schedule(callback, delay, true),
    clearInterval: (id) => timers.delete(id),
    advance(milliseconds) {
      const end = now + milliseconds;
      for (;;) {
        const next = Array.from(timers.entries())
          .filter(([, timer]) => timer.due <= end)
          .sort((left, right) => left[1].due - right[1].due)[0];
        if (!next) break;
        const [id, timer] = next;
        now = timer.due;
        if (timer.repeat) timer.due += timer.delay;
        else timers.delete(id);
        timer.callback();
      }
      now = end;
    }
  };
}

function harness({ hidden = false } = {}) {
  const effects = [];
  const requests = [];
  const clock = fakeClock();
  const document = { hidden };
  const client = {
    get(url) {
      assert.equal(url, "/strategies");
      const request = deferred();
      requests.push(request);
      return request.promise;
    }
  };
  const loadedModule = { exports: {} };
  vm.runInNewContext(compiledSource, {
    module: loadedModule,
    exports: loadedModule.exports,
    require(name) {
      if (name === "react") return { useEffect: (effect) => effects.push(effect) };
      if (name === "@/assets/lib/request") return { client };
      if (name === "@/types/strategy") return { strategyActive: (status) => ["building", "queued", "running"].includes(status) };
      if (name === "zustand") {
        return {
          create(initializer) {
            const store = realCreate(initializer);
            // Only the React selector invocation is adapted; Zustand state/updates remain real.
            return Object.assign((selector) => selector(store.getState()), store);
          }
        };
      }
      throw new Error(`Unexpected strategy store dependency: ${name}`);
    },
    Error,
    document,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval
  }, { filename: sourcePath });
  return {
    store: loadedModule.exports.useStrategyStore,
    requests,
    clock,
    document,
    mountPolling() {
      const previousCount = effects.length;
      loadedModule.exports.useStrategyPolling();
      assert.equal(effects.length, previousCount + 1);
      return effects[previousCount]();
    }
  };
}

function ids(suite) {
  return Array.from(suite.store.getState().records, (item) => item.id);
}

async function flush() {
  // Drain load() and the polling continuation without real timers or network activity.
  for (let index = 0; index < 5; index++) await Promise.resolve();
}

test("an older success cannot overwrite the newest successful list", async () => {
  const suite = harness();
  const older = suite.store.getState().load();
  const newer = suite.store.getState().load();
  const completed = record("one", "success");
  suite.requests[1].resolve([completed]);
  assert.equal(await newer, undefined);
  const acceptedState = suite.store.getState();
  suite.requests[0].resolve([record("one", "running")]);
  await older;
  assert.equal(suite.store.getState(), acceptedState);
  assert.equal(acceptedState.records[0], completed);
  assert.equal(acceptedState.loaded, true);
  assert.equal(acceptedState.error, "");
});

test("an older failure cannot replace a newer success with an error", async () => {
  const suite = harness();
  const older = suite.store.getState().load();
  const newer = suite.store.getState().load();
  suite.requests[1].resolve([record("one", "success")]);
  await newer;
  const acceptedState = suite.store.getState();
  suite.requests[0].reject(new Error("old offline error"));
  await older;
  assert.equal(suite.store.getState(), acceptedState);
  assert.equal(suite.store.getState().error, "");
});

test("a latest failure preserves cache and cannot be cleared or replaced by older responses", async () => {
  const suite = harness();
  const cached = record("cached", "success");
  suite.store.getState().upsert(cached);
  const olderSuccess = suite.store.getState().load();
  const olderFailure = suite.store.getState().load();
  const latest = suite.store.getState().load();
  suite.requests[2].reject(new Error("latest offline error"));
  await latest;
  const acceptedState = suite.store.getState();
  assert.equal(acceptedState.records[0], cached);
  assert.equal(acceptedState.error, "latest offline error");
  assert.equal(acceptedState.loaded, false);
  suite.requests[0].resolve([]);
  await olderSuccess;
  suite.requests[1].reject(new Error("older offline error"));
  await olderFailure;
  assert.equal(suite.store.getState(), acceptedState);
});

test("superseded success and failure do not publish state while the latest request is pending", async () => {
  const suite = harness();
  const olderSuccess = suite.store.getState().load();
  const olderFailure = suite.store.getState().load();
  const latest = suite.store.getState().load();
  const initialState = suite.store.getState();
  suite.requests[0].resolve([record("old")]);
  await olderSuccess;
  assert.equal(suite.store.getState(), initialState);
  suite.requests[1].reject(new Error("old error"));
  await olderFailure;
  assert.equal(suite.store.getState(), initialState);
  assert.equal(initialState.loaded, false);
  suite.requests[2].resolve([record("latest")]);
  await latest;
  assert.deepEqual(ids(suite), ["latest"]);
  assert.equal(suite.store.getState().loaded, true);
});

test("loaded requires a successful list and survives later failures, including an empty list", async () => {
  for (const rows of [[], [record("one")]]) {
    const suite = harness();
    const failed = suite.store.getState().load();
    suite.requests[0].reject(new Error("initial offline error"));
    await failed;
    assert.equal(suite.store.getState().loaded, false);
    assert.equal(suite.store.getState().error, "initial offline error");
    const retry = suite.store.getState().load();
    assert.equal(suite.store.getState().loaded, false);
    suite.requests[1].resolve(rows);
    await retry;
    const accepted = suite.store.getState().records;
    assert.equal(suite.store.getState().loaded, true);
    assert.equal(suite.store.getState().error, "");
    const refresh = suite.store.getState().load();
    suite.requests[2].reject(new Error("background offline error"));
    await refresh;
    assert.equal(suite.store.getState().loaded, true);
    assert.equal(suite.store.getState().records, accepted);
    assert.equal(suite.store.getState().error, "background offline error");
  }
});

test("a delayed creation seed cannot overwrite a newer list row or protect it from refresh", async () => {
  for (const status of ["running", "success", "failed"]) {
    const suite = harness();
    const listed = record("new", status);
    const first = suite.store.getState().load();
    suite.requests[0].resolve([listed]);
    await first;
    const acceptedState = suite.store.getState();
    const refresh = suite.store.getState().load();
    suite.store.getState().seedCreated(record("new", "queued"));
    assert.equal(suite.store.getState(), acceptedState);
    assert.equal(suite.store.getState().records[0], listed);
    const refreshed = { ...listed, duration: "45s" };
    suite.requests[1].resolve([refreshed]);
    await refresh;
    assert.equal(suite.store.getState().records[0], refreshed);
  }
});

test("a creation seed survives an older list snapshot and remains replaceable by detail upserts", async () => {
  const suite = harness();
  const pending = suite.store.getState().load();
  const created = record("new", "queued");
  suite.store.getState().seedCreated(created);
  assert.equal(suite.store.getState().records[0], created);
  suite.requests[0].resolve([]);
  await pending;
  assert.deepEqual(ids(suite), ["new"]);
  assert.equal(suite.store.getState().records[0], created);
  const completed = record("new", "success");
  suite.store.getState().upsert(completed);
  assert.equal(suite.store.getState().records[0], completed);
});

test("a list snapshot cannot roll back a terminal detail upsert made during its request", async () => {
  const suite = harness();
  suite.store.getState().upsert(record("one", "running"));
  const pending = suite.store.getState().load();
  const completed = { ...record("one", "success"), duration: "45s", name: "renamed strategy" };
  suite.store.getState().upsert(completed);
  suite.requests[0].resolve([record("one", "running")]);
  await pending;
  const state = suite.store.getState();
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0], completed);
  assert.equal(state.records[0].reportPath, "one/report");
});

test("confirmed success and failure survive every same-run active upsert and return the accepted record", async () => {
  for (const terminalStatus of ["success", "failed"]) {
    for (const activeStatus of ["building", "queued", "running"]) {
      const suite = harness();
      const completed = { ...record("one", terminalStatus), error: terminalStatus === "failed" ? "run failed" : "" };
      assert.equal(suite.store.getState().upsert(completed), completed);
      const acceptedState = suite.store.getState();
      let notifications = 0;
      const unsubscribe = suite.store.subscribe(() => notifications++);
      assert.equal(suite.store.getState().upsert(record("one", activeStatus)), completed);
      assert.equal(suite.store.getState(), acceptedState);
      assert.equal(notifications, 0);
      unsubscribe();
    }
  }
});

test("confirmed terminal rows survive active list snapshots even without an intervening mutation", async () => {
  for (const terminalStatus of ["success", "failed"]) {
    for (const activeStatus of ["building", "queued", "running"]) {
      const suite = harness();
      const completed = record("one", terminalStatus);
      const first = suite.store.getState().load();
      suite.requests[0].resolve([completed]);
      await first;
      const refresh = suite.store.getState().load();
      suite.requests[1].resolve([record("one", activeStatus)]);
      await refresh;
      assert.equal(suite.store.getState().records[0], completed);
      assert.equal(suite.store.getState().error, "");
    }
  }
});

test("a terminal list result beats an intervening active detail upsert", async () => {
  for (const terminalStatus of ["success", "failed"]) {
    for (const activeStatus of ["building", "queued", "running"]) {
      const suite = harness();
      const pending = suite.store.getState().load();
      const active = record("one", activeStatus);
      assert.equal(suite.store.getState().upsert(active), active);
      const completed = record("one", terminalStatus);
      suite.requests[0].resolve([completed]);
      await pending;
      assert.equal(suite.store.getState().records[0], completed);
    }
  }
});

test("terminal reconciliation does not rank active or terminal statuses or discard other mutations", async () => {
  const suite = harness();
  suite.store.getState().upsert(record("changed", "running"));
  suite.store.getState().upsert(record("deleted", "success"));
  const pending = suite.store.getState().load();
  const changed = record("changed", "queued");
  const created = record("created", "building");
  const terminal = record("terminal", "failed");
  suite.store.getState().upsert(changed);
  suite.store.getState().upsert(created);
  suite.store.getState().upsert(terminal);
  const serverNew = record("server-new", "success");
  suite.requests[0].resolve([record("changed", "running"), record("terminal", "success"), serverNew]);
  await pending;
  assert.deepEqual(ids(suite), ["created", "changed", "terminal", "server-new"]);
  assert.equal(suite.store.getState().records[1], changed);
  assert.equal(suite.store.getState().records[2], terminal);
  assert.equal(suite.store.getState().records[3], serverNew);
  const refresh = suite.store.getState().load();
  const refreshedActive = record("changed", "building");
  const refreshedTerminal = record("terminal", "success");
  suite.requests[1].resolve([refreshedActive, refreshedTerminal]);
  await refresh;
  assert.deepEqual(ids(suite), ["changed", "terminal"]);
  assert.equal(suite.store.getState().records[0], refreshedActive);
  assert.equal(suite.store.getState().records[1], refreshedTerminal);
});

test("a rejected active upsert does not protect a terminal row from a later list refresh or deletion", async () => {
  const suite = harness();
  const completed = record("one", "success");
  suite.store.getState().upsert(completed);
  const pending = suite.store.getState().load();
  assert.equal(suite.store.getState().upsert(record("one", "running")), completed);
  const refreshed = { ...completed, duration: "45s" };
  suite.requests[0].resolve([refreshed]);
  await pending;
  assert.equal(suite.store.getState().records[0], refreshed);
  const deletion = suite.store.getState().load();
  assert.equal(suite.store.getState().upsert(record("one", "queued")), refreshed);
  suite.requests[1].resolve([]);
  await deletion;
  assert.deepEqual(ids(suite), []);
});

test("the winning overlapping load preserves the latest upsert of a new row missing from its snapshot", async () => {
  const suite = harness();
  const older = suite.store.getState().load();
  const newer = suite.store.getState().load();
  suite.store.getState().upsert(record("new", "queued"));
  const completed = record("new", "success");
  suite.store.getState().upsert(completed);
  suite.requests[1].resolve([]);
  await newer;
  assert.deepEqual(ids(suite), ["new"]);
  assert.equal(suite.store.getState().records[0], completed);
  const acceptedState = suite.store.getState();
  suite.requests[0].resolve([record("new", "queued")]);
  await older;
  assert.equal(suite.store.getState(), acceptedState);
});

test("merging protects changed rows while updating/deleting other rows, and the next load is authoritative", async () => {
  const suite = harness();
  suite.store.getState().upsert(record("changed"));
  suite.store.getState().upsert(record("untouched"));
  suite.store.getState().upsert(record("deleted"));
  const pending = suite.store.getState().load();
  const changed = record("changed", "success");
  const created = record("created", "queued");
  const untouched = record("untouched", "failed");
  const serverNew = record("server-new", "running");
  suite.store.getState().upsert(changed);
  suite.store.getState().upsert(created);
  suite.requests[0].resolve([record("changed", "running"), untouched, serverNew]);
  await pending;
  assert.deepEqual(ids(suite), ["created", "changed", "untouched", "server-new"]);
  const byId = new Map(suite.store.getState().records.map((item) => [item.id, item]));
  assert.equal(byId.get("changed"), changed);
  assert.equal(byId.get("created"), created);
  assert.equal(byId.get("untouched"), untouched);
  assert.equal(byId.get("server-new"), serverNew);
  const next = suite.store.getState().load();
  suite.requests[1].resolve([]);
  await next;
  assert.deepEqual(ids(suite), []);
});

test("a current load failure preserves intervening writes and a retry clears the error", async () => {
  const suite = harness();
  suite.store.getState().upsert(record("one", "running"));
  const failed = suite.store.getState().load();
  const completed = record("one", "success");
  suite.store.getState().upsert(completed);
  suite.requests[0].reject("temporarily offline");
  assert.equal(await failed, undefined);
  assert.equal(suite.store.getState().records[0], completed);
  assert.equal(suite.store.getState().loaded, false);
  assert.equal(suite.store.getState().error, "temporarily offline");
  const retry = suite.store.getState().load();
  const refreshed = { ...completed, name: "server rename" };
  suite.requests[1].resolve([refreshed]);
  await retry;
  assert.equal(suite.store.getState().records[0], refreshed);
  assert.equal(suite.store.getState().error, "");
});

test("polling waits for settlement plus five seconds, and keeps retrying after a failure", async () => {
  const suite = harness();
  const cleanup = suite.mountPolling();
  assert.equal(suite.requests.length, 1);
  assert.equal(suite.clock.timers.size, 0);
  suite.clock.advance(20000);
  assert.equal(suite.requests.length, 1);
  suite.requests[0].resolve([record("one", "running")]);
  await flush();
  assert.equal(suite.clock.timers.size, 1);
  assert.equal(Array.from(suite.clock.timers.values())[0].delay, 5000);
  suite.clock.advance(4999);
  assert.equal(suite.requests.length, 1);
  suite.clock.advance(1);
  assert.equal(suite.requests.length, 2);
  assert.equal(suite.clock.timers.size, 0);
  suite.clock.advance(20000);
  assert.equal(suite.requests.length, 2);
  suite.requests[1].reject(new Error("poll offline"));
  await flush();
  assert.equal(suite.store.getState().error, "poll offline");
  assert.equal(suite.clock.timers.size, 1);
  suite.clock.advance(5000);
  assert.equal(suite.requests.length, 3);
  assert.equal(suite.clock.timers.size, 0);
  suite.requests[2].resolve([record("one", "success")]);
  await flush();
  assert.equal(suite.store.getState().error, "");
  assert.equal(suite.store.getState().records[0].status, "success");
  cleanup();
  assert.equal(suite.clock.timers.size, 0);
});

test("cleanup stops scheduled and pending follow-ups while preserving an upsert after cleanup", async () => {
  const scheduled = harness();
  const stopScheduled = scheduled.mountPolling();
  scheduled.requests[0].resolve([]);
  await flush();
  assert.equal(scheduled.clock.timers.size, 1);
  const queuedCallback = Array.from(scheduled.clock.timers.values())[0].callback;
  stopScheduled();
  assert.equal(scheduled.clock.timers.size, 0);
  // A callback already queued by the browser must also observe cleanup.
  queuedCallback();
  await flush();
  scheduled.clock.advance(15000);
  assert.equal(scheduled.requests.length, 1);
  assert.equal(scheduled.clock.timers.size, 0);

  const pending = harness();
  const stopPending = pending.mountPolling();
  stopPending();
  const created = record("new", "queued");
  pending.store.getState().upsert(created);
  pending.requests[0].resolve([]);
  await flush();
  assert.equal(pending.store.getState().records[0], created);
  assert.equal(pending.clock.timers.size, 0);
  pending.clock.advance(15000);
  assert.equal(pending.requests.length, 1);
});

test("a pending old polling lifecycle cannot overwrite a remount or schedule another loop", async () => {
  for (const outcome of ["success", "failure"]) {
    const suite = harness();
    const stopOld = suite.mountPolling();
    stopOld();
    const stopNew = suite.mountPolling();
    const created = record("new", "queued");
    const completed = record("one", "success");
    suite.store.getState().upsert(created);
    suite.requests[1].resolve([completed]);
    await flush();
    const acceptedState = suite.store.getState();
    assert.deepEqual(ids(suite), ["new", "one"]);
    assert.equal(acceptedState.records[0], created);
    assert.equal(suite.clock.timers.size, 1);
    if (outcome === "success") suite.requests[0].resolve([]);
    else suite.requests[0].reject(new Error("old lifecycle offline"));
    await flush();
    assert.equal(suite.store.getState(), acceptedState);
    assert.equal(suite.clock.timers.size, 1);
    stopNew();
    assert.equal(suite.clock.timers.size, 0);
    suite.clock.advance(15000);
    assert.equal(suite.requests.length, 2);
  }
});

test("hidden pages skip requests but retain their next tick and resume when visible", async () => {
  const suite = harness({ hidden: true });
  const cleanup = suite.mountPolling();
  assert.equal(suite.requests.length, 0);
  assert.equal(suite.clock.timers.size, 1);
  suite.clock.advance(15000);
  assert.equal(suite.requests.length, 0);
  assert.equal(suite.clock.timers.size, 1);
  suite.document.hidden = false;
  suite.clock.advance(5000);
  assert.equal(suite.requests.length, 1);
  assert.equal(suite.clock.timers.size, 0);
  suite.document.hidden = true;
  suite.requests[0].resolve([record("one")]);
  await flush();
  suite.clock.advance(10000);
  assert.equal(suite.requests.length, 1);
  assert.equal(suite.clock.timers.size, 1);
  suite.document.hidden = false;
  suite.clock.advance(5000);
  assert.equal(suite.requests.length, 2);
  cleanup();
  suite.requests[1].resolve([record("one", "success")]);
  await flush();
  assert.equal(suite.clock.timers.size, 0);
});
