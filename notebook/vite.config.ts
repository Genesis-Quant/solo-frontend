import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vite";

const source = fileURLToPath(new URL("../src", import.meta.url));
const output = fileURLToPath(new URL("../../algos/scheme/src/scheme/report/assets", import.meta.url));

export default defineConfig({
  publicDir: false,
  plugins: [
    react(), tailwindcss(), Icons({ compiler: "jsx", jsx: "react" }),
    {
      name: "scheme-duckdb-assets",
      closeBundle() {
        mkdirSync(output, { recursive: true });
        for (const file of ["duckdb-mvp.wasm", "duckdb-browser-mvp.worker.js"]) {
          const data = readFileSync(fileURLToPath(new URL(`../node_modules/@duckdb/duckdb-wasm/dist/${file}`, import.meta.url)));
          writeFileSync(`${output}/${file}.gz`, gzipSync(data));
        }
        for (const file of ["report.js", "report.css"]) {
          writeFileSync(`${output}/${file}.gz`, gzipSync(readFileSync(`${output}/${file}`)));
          unlinkSync(`${output}/${file}`);
        }
      }
    }
  ],
  resolve: { alias: { "@": source } },
  define: { "process.env.NODE_ENV": JSON.stringify("production"), "__SCHEME_NOTEBOOK__": "true" },
  build: {
    outDir: output,
    emptyOutDir: true,
    lib: { entry: fileURLToPath(new URL("./index.tsx", import.meta.url)), name: "SchemeReport", formats: ["iife"], fileName: () => "report.js", cssFileName: "report" },
    rollupOptions: { output: { inlineDynamicImports: true } },
  }
});
