import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { compileFunction } from "node:vm";
import ts from "typescript";

// Exercise the production TypeScript in memory without a bundler or browser environment.
export function loadTypeScript(path, imports = {}) {
  const file = new URL(path, import.meta.url);
  const require = createRequire(file);
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    fileName: fileURLToPath(file),
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true
    }
  });
  const module = { exports: {} };
  const load = (name) => {
    if (Object.hasOwn(imports, name)) return imports[name];
    if (name.startsWith("@/")) return loadTypeScript(`../src/${name.slice(2)}.ts`, imports);
    return require(name);
  };
  compileFunction(outputText, ["require", "module", "exports"], { filename: fileURLToPath(file) })(load, module, module.exports);
  return module.exports;
}
