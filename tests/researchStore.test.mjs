import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const requireProject = createRequire(new URL("../package.json", import.meta.url));
const ts = requireProject("typescript");
const axios = requireProject("axios");
const { create } = requireProject("zustand");
const sources = Object.fromEntries([
  ["research", "../src/store/research.ts"],
  ["request", "../src/assets/lib/request.ts"],
  ["requestError", "../src/assets/lib/requestError.ts"]
].map(([name, relative]) => {
  const filename = fileURLToPath(new URL(relative, import.meta.url));
  return [name, { filename, compiled: ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText }];
}));

// Real Zustand and Axios run against a local adapter. No request can reach an API.
function harness() {
  const requests = [], cache = new Map();
  const localAxios = {
    isAxiosError: axios.isAxiosError,
    create(config) {
      return axios.create({ ...config, adapter(config) {
        let resolve, reject;
        const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
        requests.push({
          config, url: axios.getUri(config), reject,
          resolve: (data, status = 200) => resolve({ config, data, status, statusText: "OK", headers: {} })
        });
        return promise;
      } });
    }
  };
  function load(name) {
    if (cache.has(name)) return cache.get(name).exports;
    const module = { exports: {} };
    cache.set(name, module);
    vm.runInNewContext(sources[name].compiled, {
      module, exports: module.exports, Error,
      require(dependency) {
        if (dependency === "zustand") return { create };
        if (dependency === "axios") return localAxios;
        if (dependency === "@/assets/lib/settings") return { apiUrl: "/api/v1" };
        if (dependency === "@/assets/lib/request") return load("request");
        if (dependency === "@/assets/lib/requestError") return load("requestError");
        throw new Error(`Unexpected research store dependency: ${dependency}`);
      }
    }, { filename: sources[name].filename });
    return module.exports;
  }
  const store = load("research").useResearchStore;
  const target = project("target"), retained = project("retained");
  store.setState({ projects: [target, retained], loaded: true, loading: false, error: "" });
  return { store, requests, client: load("request").client, RequestError: load("requestError").RequestError, target, retained };
}

function project(id) {
  return {
    id, name: id, description: "研究项目", kind: "model", archived: false,
    directory: `/home/jupyter/projects/${id}`, schemeVersion: "1.2.0", algoVersion: "v1.2.0",
    updatedAt: "2026-10-07T00:00:00Z", versions: []
  };
}

for (const [label, args, suffix] of [
  ["omitted option", [], "?delete_files=true"],
  ["unchecked option", [false], "?delete_files=false"],
  ["checked option", [true], "?delete_files=true"]
]) {
  test(`removeProject with ${label} sends the exact URL and removes state only after success`, async () => {
    const suite = harness();
    const initialState = suite.store.getState();
    let updates = 0;
    const unsubscribe = suite.store.subscribe(() => updates++);
    const pending = initialState.removeProject("target", ...args);
    assert.equal(suite.store.getState(), initialState);
    assert.equal(updates, 0);
    assert.equal(suite.requests.length, 1);
    const request = suite.requests[0];
    assert.equal(request.config.method, "delete");
    assert.equal(request.config.url, `/projects/target${suffix}`);
    assert.equal(request.url, `/api/v1/projects/target${suffix}`);
    assert.equal(request.config.timeout, 120000);
    request.resolve();
    await pending;
    assert.deepEqual(Array.from(suite.store.getState().projects), [suite.retained]);
    assert.equal(suite.store.getState().projects[0], suite.retained);
    assert.equal(suite.store.getState().loading, false);
    assert.equal(suite.store.getState().error, "");
    assert.equal(updates, 1);
    unsubscribe();
  });
}

for (const deleteFiles of [false, true]) {
  test(`removeProject deleteFiles=${deleteFiles} propagates an API error without removing cached state`, async () => {
    const suite = harness();
    const initialState = suite.store.getState();
    const pending = initialState.removeProject("target", deleteFiles);
    const rejected = assert.rejects(pending, { message: "项目文件夹删除失败" });
    const request = suite.requests[0];
    request.reject(new axios.AxiosError("HTTP failure", "ERR_BAD_RESPONSE", request.config, {}, {
      config: request.config, data: { detail: "项目文件夹删除失败" }, status: 500, statusText: "Internal Server Error", headers: {}
    }));
    await rejected;
    assert.equal(suite.store.getState(), initialState);
    assert.equal(initialState.projects[0], suite.target);
    assert.equal(initialState.projects[1], suite.retained);
    const retry = initialState.removeProject("target", deleteFiles);
    assert.equal(suite.store.getState(), initialState);
    assert.equal(suite.requests[1].url, request.url);
    suite.requests[1].resolve();
    await retry;
    assert.deepEqual(Array.from(suite.store.getState().projects), [suite.retained]);
  });
}

test("successful deletion preserves other projects added while the request was pending", async () => {
  const suite = harness();
  const pending = suite.store.getState().removeProject("target", true);
  const created = project("new");
  suite.store.setState({ projects: [created, suite.target, suite.retained] });
  suite.requests[0].resolve();
  await pending;
  assert.deepEqual(Array.from(suite.store.getState().projects), [created, suite.retained]);
});

function version(id = "version", overrides = {}) {
  return {
    id, number: 1, packageVersion: "1.2.1", phase: "success", note: "saved", submittedAt: "2026-10-07",
    status: "success", publishStatus: "unpublished", workflowId: 7, duration: "1s", parameters: {}, dependencies: [], ...overrides
  };
}
function publishedVersion(overrides = {}) {
  const artifact = {
    id: "accepted", package: "model-1234", version: "1.2.1",
    filename: "model_1234-1.2.1-py3-none-any.whl", size: 4321, sha256: "a".repeat(64)
  };
  return version("version", {
    publishStatus: "published", artifactId: artifact.id, artifact,
    files: [{ name: artifact.filename, size: artifact.size, url: `/api/v1/artifacts/${artifact.id}/wheel` }],
    ...overrides
  });
}
function httpFailure(request, detail, status = 409) {
  return new axios.AxiosError("private transport", "ERR_BAD_RESPONSE", request.config, {}, {
    config: request.config, data: { detail }, status, statusText: "Conflict", headers: {}
  });
}

test("publishVersion posts an empty body and accepts the updated version with real artifact metadata", async () => {
  const suite = harness();
  suite.target.versions = [version(), version("other")];
  const artifact = { id: "published-artifact", package: "model-1234", version: "1.2.1", filename: "model_1234-1.2.1-py3-none-any.whl", size: 4321, sha256: "a".repeat(64) };
  const published = version("version", { publishStatus: "published", artifactId: artifact.id, artifact });
  const pending = suite.store.getState().publishVersion("target", "version");
  assert.equal(suite.requests[0].config.url, "/projects/target/versions/version/publish");
  assert.equal(suite.requests[0].config.method, "post");
  assert.deepEqual(JSON.parse(suite.requests[0].config.data), {});
  assert.equal(suite.target.versions[0].publishStatus, "unpublished", "pending publication is not fabricated in the store");
  suite.requests[0].resolve(published);
  assert.equal(await pending, published);
  assert.equal(suite.store.getState().projects[0].versions[0], published);
  assert.equal(suite.store.getState().projects[0].versions[1].id, "other");
  assert.equal(suite.store.getState().projects[1], suite.retained);
  assert.equal(suite.store.getState().error, "");
});

test("publication conflict is typed, remains local to the caller and can be retried", async () => {
  const suite = harness();
  suite.target.versions = [version()];
  const initial = suite.store.getState();
  const pending = initial.publishVersion("target", "version");
  const rejected = assert.rejects(pending, (error) => error instanceof suite.RequestError && error.code === "artifact_release_conflict"
    && error.status === 409 && error.reason === "包版本已被不同内容发布");
  suite.requests[0].reject(httpFailure(suite.requests[0], { code: "artifact_release_conflict", reason: "包版本已被不同内容发布" }));
  await rejected;
  assert.equal(suite.store.getState(), initial);
  const retry = initial.publishVersion("target", "version");
  suite.requests[1].resolve(version("version", { publishStatus: "published", artifactId: "accepted" }));
  await retry;
  assert.equal(suite.store.getState().projects[0].versions[0].artifactId, "accepted");
  assert.equal(suite.store.getState().error, "");
});

for (const operation of ["create", "edit", "delete", "publish"]) {
  test(`a GET started before ${operation} cannot overwrite the successful mutation`, async () => {
    const suite = harness();
    suite.target.versions = [version()];
    const stale = [{ ...suite.target, versions: [version()] }, suite.retained];
    const published = publishedVersion();
    const load = suite.store.getState().loadProjects();
    let mutation;
    if (operation === "create") mutation = suite.store.getState().createProject("created", "", "model", "v1.2.0", "v1.2.0");
    if (operation === "edit") mutation = suite.store.getState().editProject("target", "renamed", "updated");
    if (operation === "delete") mutation = suite.store.getState().removeProject("target");
    if (operation === "publish") mutation = suite.store.getState().publishVersion("target", "version");
    suite.requests[1].resolve(operation === "create" ? project("created") : operation === "edit"
      ? { ...suite.target, name: "renamed", description: "updated" }
      : operation === "publish" ? published : undefined);
    await mutation;
    suite.requests[0].resolve(stale);
    await load;
    const state = suite.store.getState();
    if (operation === "create") assert.equal(state.projects[0].id, "created");
    if (operation === "edit") assert.equal(state.projects.find((item) => item.id === "target").name, "renamed");
    if (operation === "delete") assert.ok(!state.projects.some((item) => item.id === "target"));
    if (operation === "publish") {
      assert.equal(state.projects[0].versions[0], published);
      assert.equal(state.projects[0].versions[0].files[0].url, "/api/v1/artifacts/accepted/wheel");
    }
    assert.equal(state.error, "");
  });
}

test("latest GET wins and stale load errors cannot hide a mutation", async () => {
  const suite = harness();
  const old = suite.store.getState().loadProjects();
  const recent = suite.store.getState().loadProjects();
  suite.requests[1].resolve([]);
  await recent;
  suite.requests[0].resolve([suite.target]);
  await old;
  assert.equal(suite.store.getState().projects.length, 0);
  const failed = suite.store.getState().loadProjects();
  const create = suite.store.getState().createProject("new", "", "model", "v1.2.0", "v1.2.0");
  suite.requests[3].resolve(project("new"));
  await create;
  suite.requests[2].reject(httpFailure(suite.requests[2], "stale failure", 500));
  await failed;
  assert.equal(suite.store.getState().error, "");
  assert.equal(suite.store.getState().projects[0].id, "new");
});

test("successful empty loads stay loaded without blanking the UI on every poll", async () => {
  const suite = harness();
  suite.store.setState({ projects: [], loaded: false, loading: true });
  const first = suite.store.getState().loadProjects();
  suite.requests[0].resolve([]);
  await first;
  assert.equal(suite.store.getState().loaded, true);
  assert.equal(suite.store.getState().loading, false);
  const next = suite.store.getState().loadProjects();
  assert.equal(suite.store.getState().loading, false);
  suite.requests[1].resolve([]);
  await next;
});

test("polls after publication accept authoritative artifact removal without retaining obsolete wheel links", async () => {
  const suite = harness();
  suite.target.versions = [version()];
  const accepted = publishedVersion();
  const publish = suite.store.getState().publishVersion("target", "version");
  suite.requests[0].resolve(accepted);
  await publish;
  assert.equal(suite.store.getState().projects[0].versions[0], accepted);
  assert.equal(accepted.files[0].url, "/api/v1/artifacts/accepted/wheel");

  const unpublished = version("version", { artifactId: null, artifact: null, files: [] });
  for (let poll = 0; poll < 3; poll++) {
    const load = suite.store.getState().loadProjects();
    suite.requests.at(-1).resolve([{ ...suite.target, versions: [unpublished] }, suite.retained]);
    await load;
    const actual = suite.store.getState().projects[0].versions[0];
    assert.equal(actual.status, "success");
    assert.equal(actual.publishStatus, "unpublished");
    assert.equal(actual.artifactId, null);
    assert.equal(actual.artifact, null);
    assert.equal(actual.files, unpublished.files);
    assert.equal(actual.files.length, 0);
    assert.doesNotMatch(JSON.stringify(actual), /accepted|\.whl|\/wheel/);
    assert.equal(suite.store.getState().projects[1].id, "retained");
    assert.equal(suite.store.getState().error, "");
  }
});

for (const status of ["success", "failed"]) {
  test(`polling preserves terminal ${status} run details but accepts publication removal despite bogus running`, async () => {
    const suite = harness();
    const saved = publishedVersion({ status, phase: status, error: "saved run detail", reportPath: "/saved/report" });
    suite.target.versions = [saved];
    const incoming = version("version", {
      status: "running", phase: "queued", duration: "0s", error: "bogus running detail", reportPath: "/bogus/report",
      artifactId: null, artifact: null, files: []
    });
    for (let poll = 0; poll < 2; poll++) {
      const load = suite.store.getState().loadProjects();
      suite.requests.at(-1).resolve([{ ...suite.target, versions: [incoming] }]);
      await load;
      const actual = suite.store.getState().projects[0].versions[0];
      assert.equal(actual.status, saved.status);
      assert.equal(actual.phase, saved.phase);
      assert.equal(actual.duration, saved.duration);
      assert.equal(actual.error, saved.error);
      assert.equal(actual.reportPath, saved.reportPath);
      assert.equal(actual.publishStatus, "unpublished");
      assert.equal(actual.artifactId, null);
      assert.equal(actual.artifact, null);
      assert.equal(actual.files, incoming.files);
      assert.equal(actual.publishError, undefined);
      assert.doesNotMatch(JSON.stringify(actual), /accepted|\.whl|\/wheel/);
    }
    const removed = suite.store.getState().loadProjects();
    suite.requests.at(-1).resolve([]);
    await removed;
    assert.equal(suite.store.getState().projects.length, 0);
  });
}

test("publication updates remain authoritative when an incoming running status is ignored", async () => {
  const suite = harness();
  const saved = publishedVersion();
  suite.target.versions = [saved];
  const replacement = publishedVersion({
    status: "running", phase: "queued",
    artifactId: "replacement",
    artifact: { ...saved.artifact, id: "replacement", filename: "replacement.whl" },
    files: [{ name: "replacement.whl", url: "/api/v1/artifacts/replacement/wheel" }]
  });
  const load = suite.store.getState().loadProjects();
  suite.requests[0].resolve([{ ...suite.target, versions: [replacement] }]);
  await load;
  const actual = suite.store.getState().projects[0].versions[0];
  assert.equal(actual.status, "success");
  assert.equal(actual.phase, "success");
  assert.equal(actual.publishStatus, "published");
  assert.equal(actual.artifactId, "replacement");
  assert.equal(actual.artifact, replacement.artifact);
  assert.equal(actual.files, replacement.files);

  const failed = version("version", {
    status: "running", phase: "queued", publishStatus: "failed", publishError: "registry rejected publication"
  });
  const next = suite.store.getState().loadProjects();
  suite.requests[1].resolve([{ ...suite.target, versions: [failed] }]);
  await next;
  const failure = suite.store.getState().projects[0].versions[0];
  assert.equal(failure.status, "success");
  assert.equal(failure.phase, "success");
  assert.equal(failure.publishStatus, "failed");
  assert.equal(failure.publishError, failed.publishError);
  assert.equal(failure.artifactId, undefined);
  assert.equal(failure.artifact, undefined);
  assert.equal(failure.files, undefined);
});

test("a submit_failed raw phase can transition to queued when the same saved submission is retried", async () => {
  const suite = harness();
  suite.target.versions = [version("version", { status: "failed", phase: "submit_failed" })];
  const load = suite.store.getState().loadProjects();
  suite.requests[0].resolve([{ ...suite.target, versions: [version("version", { status: "running", phase: "queued" })] }]);
  await load;
  assert.equal(suite.store.getState().projects[0].versions[0].phase, "queued");
  assert.equal(suite.store.getState().projects[0].versions[0].status, "running");
});

test("partial cleanup removes only the original UUID and allows an ID-specific retry after polling", async () => {
  const suite = harness();
  const oldLoad = suite.store.getState().loadProjects();
  const pending = suite.store.getState().removeProject("target", false);
  const rejected = assert.rejects(pending, (error) => error.deleted === true && error.id === "target" && error.code === "project_cleanup_incomplete");
  suite.requests[1].reject(httpFailure(suite.requests[1], { code: "project_cleanup_incomplete", reason: "运行资源清理失败", deleted: true, id: "target" }, 500));
  await rejected;
  assert.ok(!suite.store.getState().projects.some((item) => item.id === "target"));
  suite.requests[0].resolve([suite.target, suite.retained]);
  await oldLoad;
  assert.ok(!suite.store.getState().projects.some((item) => item.id === "target"));
  const replacement = { ...project("new-uuid"), name: suite.target.name };
  suite.store.setState({ projects: [replacement, suite.retained] });
  const retry = suite.store.getState().removeProject("target", false);
  assert.equal(suite.requests[2].config.url, "/projects/target?delete_files=false");
  suite.requests[2].resolve();
  await retry;
  assert.equal(suite.store.getState().projects[0], replacement);
});

test("a late publication response never resurrects a removed source", async () => {
  const suite = harness();
  suite.target.versions = [version()];
  const publish = suite.store.getState().publishVersion("target", "version");
  const remove = suite.store.getState().removeProject("target");
  suite.requests[1].resolve();
  await remove;
  suite.requests[0].resolve(version("version", { publishStatus: "published", artifactId: "accepted" }));
  await publish;
  assert.deepEqual(Array.from(suite.store.getState().projects), [suite.retained]);
});

test("the longer DELETE timeout leaves existing GET, POST and PATCH timeouts unchanged", async () => {
  const suite = harness();
  for (const [method, timeout] of [["get", 60000], ["post", 660000], ["patch", 660000]]) {
    const pending = suite.client[method]("/test-only", {});
    const request = suite.requests.at(-1);
    assert.equal(request.config.method, method);
    assert.equal(request.config.timeout, timeout);
    request.resolve();
    await pending;
  }
});
