import * as duckdb from "@duckdb/duckdb-wasm";
import duckdbEhWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import duckdbEhWasm from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import duckdbMvpWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import duckdbMvpWasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";

const bundles: duckdb.DuckDBBundles = {
  mvp: { mainModule: duckdbMvpWasm, mainWorker: duckdbMvpWorker },
  eh: { mainModule: duckdbEhWasm, mainWorker: duckdbEhWorker }
};

export class BrowserDuckDb {
  private constructor(private readonly database: duckdb.AsyncDuckDB, private readonly connection: duckdb.AsyncDuckDBConnection) {}

  static async create(files: Record<string, ArrayBuffer>) {
    const bundle = await duckdb.selectBundle(bundles);
    if (!bundle.mainWorker) throw new Error("当前浏览器无法启动 DuckDB Worker");
    const worker = new Worker(bundle.mainWorker);
    const database = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker);
    await database.instantiate(bundle.mainModule, bundle.pthreadWorker);
    for (const [name, buffer] of Object.entries(files)) await database.registerFileBuffer(name, new Uint8Array(buffer));
    return new BrowserDuckDb(database, await database.connect());
  }

  async register(name: string, buffer: ArrayBuffer) {
    await this.database.registerFileBuffer(name, new Uint8Array(buffer));
  }

  async rows(sql: string): Promise<Record<string, unknown>[]> {
    const table = await this.connection.query(sql);
    return table.toArray().map((row) => {
      const value = row && typeof row === "object" && "toJSON" in row && typeof row.toJSON === "function" ? row.toJSON() : row;
      return value as Record<string, unknown>;
    });
  }

  async close() {
    await this.connection.close();
    await this.database.dropFiles();
    await this.database.terminate();
  }
}

export function duckDbDateValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number" || typeof value === "bigint") {
    const number = Number(value);
    const milliseconds = Math.abs(number) > 10_000_000_000_000 ? number / 1000 : number;
    const date = new Date(milliseconds);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}
