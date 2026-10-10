import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8")
  .replaceAll("import.meta.url", JSON.stringify(new URL("../vite.config.ts", import.meta.url).href));
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true
} }).outputText;

function proxy(env = {}) {
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    URL, module, exports: module.exports,
    require(name) {
      if (name === "node:url") return { fileURLToPath };
      if (name === "vite") return { defineConfig: (fn) => fn, loadEnv: () => env };
      return { __esModule: true, default: () => ({}) };
    }
  });
  const configuration = module.exports.default({ mode: "development" });
  return configuration.server.proxy;
}

function outgoing(config, request) {
  let callback;
  config.configure({ on(event, fn) { assert.equal(event, "proxyReq"); callback = fn; } });
  const headers = {};
  callback({ setHeader(name, value) { headers[name] = value; } }, request);
  return headers;
}

test("Jupyter proxy strips only its prefix and keeps a fixed server target", () => {
  const configs = proxy({ SOLO_JUPYTER_API_URL: "http://jupyter:8888", SOLO_JUPYTER_BROWSER_URL: "http://127.0.0.1:8888" });
  assert.equal(configs["/jupyter"].target, "http://jupyter:8888");
  assert.equal(configs["/jupyter"].rewrite("/jupyter/solo/files/x.parquet?download=1"), "/solo/files/x.parquet?download=1");
  assert.equal(configs["/jupyter"].rewrite("/jupyter-evil/solo/files/x.parquet"), "/jupyter-evil/solo/files/x.parquet");
  assert.equal(configs["/api"].target, "http://127.0.0.1:8010");
});

test("proxy preserves browser cookie authentication without adding tokens or weakening Origin", () => {
  const config = proxy()["/jupyter"];
  const request = { headers: { host: "127.0.0.1:5174", referer: "http://127.0.0.1:5174/embed/report?source=jupyter", cookie: "browser-session", origin: "https://untrusted.invalid" }, socket: {} };
  const before = structuredClone(request);
  assert.deepEqual(outgoing(config, request), { Host: "127.0.0.1:8888", Referer: "http://127.0.0.1:8888/embed/report?source=jupyter" });
  assert.deepEqual(request, before);
  assert.equal(Object.hasOwn(outgoing(config, request), "Authorization"), false);
});

test("download Referer rewriting is limited to the exact incoming frontend origin", () => {
  const config = proxy({ SOLO_JUPYTER_BROWSER_URL: "https://notebook.example.invalid/base/" })["/jupyter"];
  for (const referer of [undefined, "invalid", "https://attacker.invalid/", "http://localhost:5174/embed/report", "https://127.0.0.1:5174/embed/report", "http://user:secret@127.0.0.1:5174/embed/report"]) {
    const headers = outgoing(config, { headers: { host: "127.0.0.1:5174", ...(referer ? { referer } : {}) }, socket: {} });
    assert.deepEqual(headers, { Host: "notebook.example.invalid" });
  }
  const https = outgoing(config, { headers: { host: "frontend.example.invalid", referer: "https://frontend.example.invalid/embed/report?source=jupyter" }, socket: { encrypted: true } });
  assert.deepEqual(https, { Host: "notebook.example.invalid", Referer: "https://notebook.example.invalid/embed/report?source=jupyter" });
});
