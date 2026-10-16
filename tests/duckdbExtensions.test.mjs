import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const manifest = JSON.parse(readFileSync(new URL("../src/assets/duckdb-extensions.json", import.meta.url), "utf8"));

function load(relative, overrides = {}, globals = {}) {
  const filename = fileURLToPath(new URL(relative, import.meta.url));
  const source = readFileSync(filename, "utf8").replaceAll("import.meta.env.BASE_URL", "'/solo/'");
  const compiled = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, ...globals,
    require(name) {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name.endsWith("?url")) return name;
      return require(name);
    }
  }, { filename });
  return module.exports;
}

const extensions = load("../src/assets/lib/duckdbExtensions.ts", { "../duckdb-extensions.json": manifest });

test("local loading disables automatic network installation before loading Parquet", async () => {
  const sql = [];
  await extensions.loadParquetExtension({ query: async (value) => sql.push(value) }, manifest.duckdbVersion, "https://solo.test/it's-local/duckdb-extensions");
  assert.deepEqual(sql, [
    "SET autoinstall_known_extensions = false",
    "SET autoload_known_extensions = false",
    "SET custom_extension_repository = 'https://solo.test/it''s-local/duckdb-extensions'",
    "SET autoinstall_extension_repository = 'https://solo.test/it''s-local/duckdb-extensions'",
    "LOAD parquet"
  ]);
});

test("a mismatched core is rejected before any extension query", async () => {
  const sql = [];
  await assert.rejects(extensions.loadParquetExtension({ query: async (value) => sql.push(value) }, "v1.5.5", "https://solo.test/duckdb-extensions"), /不匹配/);
  assert.deepEqual(sql, []);
});

test("missing local extension reports a deployment error without trying another repository", async () => {
  const cause = new Error("404");
  const sql = [];
  await assert.rejects(extensions.loadParquetExtension({ query: async (value) => {
    sql.push(value);
    if (value === "LOAD parquet") throw cause;
  } }, manifest.duckdbVersion, "https://solo.test/duckdb-extensions"), (error) => {
    assert.match(error.message, /本地 Parquet 扩展加载失败/);
    assert.equal(error.cause, cause);
    return true;
  });
  assert.equal(sql.length, 5);
  assert.ok(sql.every((value) => !value.includes("extensions.duckdb.org")));
});

function mockDatabase(failure) {
  const events = [];
  const connection = {
    async query(sql) { events.push(sql); if (sql === "LOAD parquet" && failure) throw failure; },
    async close() { events.push("connection.close"); }
  };
  class AsyncDuckDB {
    async instantiate() { events.push("instantiate"); }
    async connect() { events.push("connect"); return connection; }
    async getVersion() { return manifest.duckdbVersion; }
    async registerFileBuffer(name) { events.push(`register:${name}`); }
    async dropFiles() { events.push("dropFiles"); }
    async terminate() { events.push("terminate"); }
  }
  const { BrowserDuckDb } = load("../src/assets/lib/duckdb.ts", {
    "@duckdb/duckdb-wasm": { AsyncDuckDB, ConsoleLogger: class {}, LogLevel: { WARNING: 0 }, selectBundle: async (bundles) => bundles.eh },
    "./duckdbExtensions": extensions
  }, { URL, window: { location: { href: "https://solo.test/solo/projects/factor" } }, Worker: class { terminate() { events.push("worker.terminate"); } } });
  return { BrowserDuckDb, events };
}

test("browser initialization loads the same-origin extension before registering report files", async () => {
  const { BrowserDuckDb, events } = mockDatabase();
  const db = await BrowserDuckDb.create({ "report.parquet": new ArrayBuffer(0) });
  assert.ok(events.includes("SET custom_extension_repository = 'https://solo.test/solo/duckdb-extensions'"));
  assert.ok(events.indexOf("LOAD parquet") < events.indexOf("register:report.parquet"));
  await db.close();
  assert.deepEqual(events.slice(-3), ["connection.close", "dropFiles", "terminate"]);
});

test("failed initialization closes the connection and terminates the worker", async () => {
  const { BrowserDuckDb, events } = mockDatabase(new Error("missing extension"));
  await assert.rejects(BrowserDuckDb.create({ "report.parquet": new ArrayBuffer(0) }), /本地 Parquet 扩展加载失败/);
  assert.ok(!events.includes("register:report.parquet"));
  assert.deepEqual(events.slice(-2), ["connection.close", "terminate"]);
});

for (const platform of ["wasm_eh", "wasm_mvp"]) {
  test(`${platform} reads real Parquet while all external extension requests are blocked`, async () => {
    const duckdb = require("@duckdb/duckdb-wasm/blocking");
    const dist = new URL("../node_modules/@duckdb/duckdb-wasm/dist/", import.meta.url);
    const modulePath = (variant) => fileURLToPath(new URL(`duckdb-${variant}.wasm`, dist));
    const repository = "http://solo.test/duckdb-extensions";
    const expected = `${repository}/${manifest.extensions.parquet[platform].file}`;
    const calls = [];
    const previous = globalThis.XMLHttpRequest;
    globalThis.XMLHttpRequest = class {
      open(method, url, asynchronous) {
        assert.equal(method, "GET");
        assert.equal(url, expected, `external or incorrect extension URL: ${url}`);
        assert.equal(asynchronous, false);
        this.url = url;
        calls.push(url);
      }
      send() {
        const asset = new URL(`../public/duckdb-extensions/${manifest.extensions.parquet[platform].file}`, import.meta.url);
        const bytes = readFileSync(asset);
        this.response = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        this.status = 200;
      }
    };
    const bundles = { mvp: { mainModule: modulePath("mvp") }, ...(platform === "wasm_eh" ? { eh: { mainModule: modulePath("eh") } } : {}) };
    let db;
    let connection;
    try {
      db = await duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
      await db.instantiate();
      connection = db.connect();
      assert.equal(connection.query("PRAGMA platform").toArray()[0].platform, platform);
      await extensions.loadParquetExtension({ query: async (sql) => connection.query(sql) }, db.getVersion(), repository);
      assert.deepEqual(calls, [expected]);
      const security = connection.query("SELECT value FROM duckdb_settings() WHERE name IN ('allow_unsigned_extensions', 'allow_extensions_metadata_mismatch')").toArray();
      assert.ok(security.every((row) => row.value === "false"));
      connection.query("COPY (SELECT 42 AS value) TO 'fixture.parquet' (FORMAT PARQUET)");
      const parquet = db.copyFileToBuffer("fixture.parquet");
      assert.equal(Buffer.from(parquet).subarray(0, 4).toString(), "PAR1");
      db.registerFileBuffer("report.parquet", parquet);
      const rows = connection.query("SELECT value FROM read_parquet('report.parquet')").toArray().map((row) => row.toJSON());
      assert.deepEqual(rows, [{ value: 42 }]);
      assert.deepEqual(calls, [expected]);
    } finally {
      connection?.close();
      db?.dropFiles();
      db?.reset();
      if (previous === undefined) delete globalThis.XMLHttpRequest;
      else globalThis.XMLHttpRequest = previous;
    }
  });
}
