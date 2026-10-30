import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTypeScript } from "./loadTypeScript.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

function task(overrides = {}) {
  const active = ["building", "queued", "running", "retrying", "stopping"].includes(overrides.status ?? "running");
  return {
    id: "task-1", name: "Regression task", kind: "factor", projectId: "project-1", version: 1, note: "",
    createdAt: "2026-10-24T09:00:00", attemptCreatedAt: "2026-10-24T09:00:00", status: "running",
    workflowId: 10, attempt: 1, startedAt: "2026-10-24T09:00:00", finishedAt: null,
    durationSeconds: 0, syncError: "", error: "", canStop: active, canRetry: !active,
    checkpoints: [], href: "/projects/project-1", attempts: [], ...overrides
  };
}

function harness(records = [task()]) {
  const gets = [];
  const posts = [];
  const client = {
    get: (url) => {
      assert.equal(url, "/tasks");
      const response = deferred();
      gets.push(response);
      return response.promise;
    },
    post: (url, body) => {
      const response = deferred();
      posts.push({ ...response, url, body });
      return response.promise;
    }
  };
  const { useTaskStore: store } = loadTypeScript("../src/store/tasks.ts", { "@/assets/lib/request": { client } });
  store.setState({ records, loaded: true });
  return { store, gets, posts };
}

for (const status of ["stopped", "success", "failed", "submit_failed"]) {
  test(`GET ${status} before an old POST stopping response preserves the terminal snapshot`, async () => {
    const initial = task();
    const other = task({ id: "task-2" });
    const { store, gets, posts } = harness([initial, other]);
    const control = store.getState().control(initial, "stop");
    assert.deepEqual(store.getState().pending, { [initial.id]: "stop" });
    assert.equal(posts[0].url, "/tasks/task-1/stop");
    assert.deepEqual(posts[0].body, { attempt: 1 });

    const load = store.getState().load();
    const terminal = task({ status, finishedAt: "2026-10-24T09:01:00", durationSeconds: 60 });
    gets[0].resolve([terminal, other]);
    await load;
    posts[0].resolve(task({ status: "stopping", durationSeconds: 30 }));
    const result = await control;

    assert.strictEqual(store.getState().records[0], terminal);
    assert.strictEqual(store.getState().records[1], other);
    assert.strictEqual(result, terminal);
    assert.deepEqual(store.getState().pending, {});
    assert.equal(store.getState().loading, false);
  });
}

test("GET higher attempt before an old POST cannot roll the task or its history back", async () => {
  const initial = task();
  const { store, gets, posts } = harness([initial]);
  const control = store.getState().control(initial, "stop");
  const load = store.getState().load();
  const newer = task({ attempt: 2, status: "running", workflowId: 20, attempts: [{ id: "attempt-2", number: 2 }] });
  gets[0].resolve([newer]);
  await load;
  posts[0].resolve(task({ status: "stopping" }));
  assert.strictEqual(await control, newer);
  assert.strictEqual(store.getState().records[0], newer);
  assert.deepEqual(store.getState().pending, {});
});

test("an old retry response cannot replace an even higher attempt observed by GET", async () => {
  const initial = task({ status: "failed" });
  const { store, gets, posts } = harness([initial]);
  const control = store.getState().control(initial, "retry");
  const load = store.getState().load();
  const newer = task({ attempt: 3, workflowId: 30 });
  gets[0].resolve([newer]);
  await load;
  posts[0].resolve(task({ attempt: 2, status: "queued" }));
  assert.strictEqual(await control, newer);
  assert.strictEqual(store.getState().records[0], newer);
});

test("an accepted retry advances terminal attempt n to n + 1", async () => {
  const initial = task({ attempt: 4, status: "failed" });
  const { store, posts } = harness([initial]);
  const control = store.getState().control(initial, "retry");
  assert.equal(posts[0].url, "/tasks/task-1/retry");
  assert.deepEqual(posts[0].body, { attempt: 4 });
  const retried = task({ attempt: 5, status: "queued", workflowId: 50 });
  posts[0].resolve(retried);
  assert.strictEqual(await control, retried);
  assert.strictEqual(store.getState().records[0], retried);
  assert.deepEqual(store.getState().pending, {});
});

test("ordinary same-attempt stop responses and subsequent GET updates are applied", async () => {
  const initial = task();
  const { store, gets, posts } = harness([initial]);
  const control = store.getState().control(initial, "stop");
  const stopping = task({ status: "stopping", durationSeconds: 20 });
  posts[0].resolve(stopping);
  assert.strictEqual(await control, stopping);
  assert.strictEqual(store.getState().records[0], stopping);

  const load = store.getState().load();
  const stopped = task({ status: "stopped", finishedAt: "2026-10-24T09:01:00", durationSeconds: 60 });
  gets[0].resolve([stopped]);
  await load;
  assert.strictEqual(store.getState().records[0], stopped);
  assert.equal(store.getState().error, "");
});

test("a same-attempt terminal POST response is a normal accepted update", async () => {
  const initial = task();
  const { store, posts } = harness([initial]);
  const control = store.getState().control(initial, "stop");
  const stopped = task({ status: "stopped", finishedAt: "2026-10-24T09:01:00" });
  posts[0].resolve(stopped);
  assert.strictEqual(await control, stopped);
  assert.strictEqual(store.getState().records[0], stopped);
});

test("GET started before control completion cannot overwrite that control response", async () => {
  const initial = task({ status: "failed" });
  const other = task({ id: "task-2" });
  const { store, gets, posts } = harness([initial, other]);
  const load = store.getState().load();
  const control = store.getState().control(initial, "retry");
  const retried = task({ attempt: 2, status: "queued" });
  posts[0].resolve(retried);
  await control;
  const otherUpdated = task({ id: "task-2", durationSeconds: 45 });
  gets[0].resolve([initial, otherUpdated]);
  await load;
  assert.strictEqual(store.getState().records[0], retried);
  assert.strictEqual(store.getState().records[1], otherUpdated);
});

test("GET started while a control POST is pending also keeps its later accepted response", async () => {
  const initial = task();
  const { store, gets, posts } = harness([initial]);
  const control = store.getState().control(initial, "stop");
  const load = store.getState().load();
  const stopping = task({ status: "stopping" });
  posts[0].resolve(stopping);
  await control;
  gets[0].resolve([initial]);
  await load;
  assert.strictEqual(store.getState().records[0], stopping);
});

test("the latest GET wins over an older concurrent GET", async () => {
  const { store, gets } = harness();
  const older = store.getState().load();
  const newer = store.getState().load();
  const terminal = task({ status: "success" });
  gets[1].resolve([terminal]);
  await newer;
  gets[0].resolve([task()]);
  await older;
  assert.strictEqual(store.getState().records[0], terminal);
  assert.equal(store.getState().loading, false);
});

test("a rejected old POST does not pin a bad attempt count against a later authoritative GET", async () => {
  const initial = task();
  const { store, gets, posts } = harness([initial]);
  const control = store.getState().control(initial, "stop");
  const load = store.getState().load();
  gets[0].resolve([task({ attempt: 99 })]);
  await load;
  posts[0].resolve(task({ status: "stopping" }));
  await control;
  assert.equal(store.getState().records[0].attempt, 99);

  const correction = store.getState().load();
  const corrected = task({ attempt: 2, status: "stopped" });
  gets[1].resolve([corrected]);
  await correction;
  assert.strictEqual(store.getState().records[0], corrected);
});

test("a fresh GET can reconcile terminal metadata or a genuinely incorrect status", async () => {
  const { store, gets } = harness([task({ status: "stopped" })]);
  const load = store.getState().load();
  const corrected = task({ status: "running", syncError: "reconciled" });
  gets[0].resolve([corrected]);
  await load;
  assert.strictEqual(store.getState().records[0], corrected);
});

test("failed control requests release pending state without changing records", async () => {
  const initial = task();
  const { store, posts } = harness([initial]);
  const control = store.getState().control(initial, "stop");
  const error = new Error("request failed");
  const rejected = assert.rejects(control, (cause) => cause === error);
  posts[0].reject(error);
  await rejected;
  assert.strictEqual(store.getState().records[0], initial);
  assert.deepEqual(store.getState().pending, {});
});

test("deleted task disappears immediately and an in-flight poll cannot restore it", async () => {
  const initial = task();
  const { store, gets } = harness([initial, task({ id: "task-2" })]);
  const load = store.getState().load();
  store.getState().forget(initial.id);
  assert.deepEqual(store.getState().records.map((item) => item.id), ["task-2"]);
  gets[0].resolve([initial, task({ id: "task-2" })]);
  await load;
  assert.deepEqual(store.getState().records.map((item) => item.id), ["task-2"]);
});

test("duplicate controls and controls for an obsolete attempt never submit a POST", async () => {
  const initial = task();
  const { store, posts } = harness([initial]);
  const control = store.getState().control(initial, "stop");
  await assert.rejects(store.getState().control(initial, "stop"), /正在提交/);
  assert.equal(posts.length, 1);
  const newer = task({ attempt: 2 });
  posts[0].resolve(newer);
  await control;
  await assert.rejects(store.getState().control(initial, "stop"), /轮次已变化/);
  assert.equal(posts.length, 1);
});
