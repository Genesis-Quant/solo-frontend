import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function verifyDuckDbExtensions(root = new URL("../", import.meta.url)) {
  const manifest = JSON.parse(readFileSync(new URL("src/assets/duckdb-extensions.json", root), "utf8"));
  const installed = JSON.parse(readFileSync(new URL("node_modules/@duckdb/duckdb-wasm/package.json", root), "utf8"));
  const declared = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  assert.equal(installed.version, manifest.packageVersion, "DuckDB package does not match the vendored extensions");
  assert.equal(declared.dependencies["@duckdb/duckdb-wasm"], manifest.packageVersion, "DuckDB must be pinned to the vendored extension version");
  for (const platform of ["wasm_eh", "wasm_mvp"]) {
    const asset = manifest.extensions.parquet[platform];
    const filename = `${manifest.duckdbVersion}/${platform}/parquet.duckdb_extension.wasm`;
    assert.equal(asset.file, filename);
    assert.equal(asset.source, `https://extensions.duckdb.org/${filename}`);
    const bytes = readFileSync(new URL(`public/duckdb-extensions/${filename}`, root));
    assert.equal(bytes.length, asset.bytes, `${platform}: extension size changed`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256, `${platform}: extension checksum changed`);
    assert.equal(bytes.subarray(0, 8).toString("hex"), "0061736d01000000", `${platform}: invalid WASM`);
    const signature = bytes.subarray(-1024);
    for (const value of ["duckdb_signature", manifest.duckdbVersion, platform]) {
      assert.ok(signature.includes(Buffer.from(value)), `${platform}: missing extension metadata ${value}`);
    }
  }
  return manifest;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const manifest = verifyDuckDbExtensions();
  console.log(`DuckDB ${manifest.duckdbVersion}: local Parquet extensions verified for wasm_eh and wasm_mvp`);
}
