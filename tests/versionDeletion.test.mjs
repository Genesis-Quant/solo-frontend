import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTypeScript } from "./loadTypeScript.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

function project() {
  return {
    id: "project-1", name: "Deletion test", updatedAt: "2026-10-30T10:00:00Z",
    versions: [{ id: "v3", number: 3 }, { id: "v2", number: 2 }]
  };
}

function harness() {
  const deletes = [];
  const gets = [];
  const forgotten = [];
  const client = {
    delete: (url) => {
      const response = deferred();
      deletes.push({ ...response, url });
      return response.promise;
    },
    get: (url) => {
      assert.equal(url, "/projects");
      const response = deferred();
      gets.push(response);
      return response.promise;
    }
  };
  const { useResearchStore: store } = loadTypeScript("../src/store/research.ts", {
    "@/assets/lib/request": { client },
    "@/store/tasks": { useTaskStore: { getState: () => ({ forget: (id) => forgotten.push(id) }) } }
  });
  const initial = project();
  store.setState({ projects: [initial], loaded: true });
  return { store, deletes, gets, initial, forgotten };
}

const deleted = { id: "v3", number: 3, freedBytes: 1024, cleanupPending: false };

test("delete removes the selected version and its task without keeping a recovery row", async () => {
  const { store, deletes, forgotten } = harness();
  const request = store.getState().deleteVersion("project-1", "v3");
  assert.equal(deletes[0].url, "/projects/project-1/versions/v3");
  assert.equal(store.getState().projects[0].versions.length, 2);
  deletes[0].resolve(deleted);
  assert.equal(await request, undefined);
  assert.deepEqual(store.getState().projects[0].versions.map((v) => v.id), ["v2"]);
  assert.deepEqual(forgotten, ["v3"]);
  assert.equal(Object.hasOwn(store.getState().projects[0], "versionCleanups"), false);
});

test("failed delete keeps the selected version and report available", async () => {
  const { store, deletes, initial, forgotten } = harness();
  const request = store.getState().deleteVersion("project-1", "v3");
  const rejected = assert.rejects(request, /busy/);
  deletes[0].reject(new Error("busy"));
  await rejected;
  assert.strictEqual(store.getState().projects[0], initial);
  assert.deepEqual(forgotten, []);
});

test("a pending backend cleanup never adds a visible deleted version or recovery row", async () => {
  const { store, deletes, forgotten } = harness();
  const request = store.getState().deleteVersion("project-1", "v3");
  deletes[0].resolve({ ...deleted, cleanupPending: true, error: "worker unavailable" });
  await request;
  assert.deepEqual(store.getState().projects[0].versions.map((v) => v.id), ["v2"]);
  assert.deepEqual(forgotten, ["v3"]);
  assert.equal(JSON.stringify(store.getState().projects).includes("worker unavailable"), false);
  assert.equal(Object.hasOwn(store.getState().projects[0], "versionCleanups"), false);
});

test("a poll started before delete completion cannot resurrect a deleted version", async () => {
  const { store, deletes, gets, initial } = harness();
  const load = store.getState().loadProjects();
  const request = store.getState().deleteVersion("project-1", "v3");
  deletes[0].resolve(deleted);
  await request;
  gets[0].resolve([initial]);
  await load;
  assert.deepEqual(store.getState().projects[0].versions.map((v) => v.id), ["v2"]);
});

test("deleting the final version leaves only the project's empty version list", async () => {
  const { store, deletes } = harness();
  store.setState({ projects: [{ ...project(), versions: [{ id: "v3", number: 3 }] }] });
  const request = store.getState().deleteVersion("project-1", "v3");
  deletes[0].resolve(deleted);
  await request;
  assert.deepEqual(store.getState().projects[0].versions, []);
  assert.equal(Object.hasOwn(store.getState().projects[0], "versionCleanups"), false);
});
