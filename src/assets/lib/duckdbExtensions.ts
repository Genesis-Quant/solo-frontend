import manifest from "../duckdb-extensions.json";

type ExtensionConnection = { query(sql: string): Promise<unknown> };

export async function loadParquetExtension(connection: ExtensionConnection, version: string, repository: string) {
  if (version !== manifest.duckdbVersion) throw new Error(`DuckDB ${version} 与本地 Parquet 扩展 ${manifest.duckdbVersion} 不匹配`);
  const literal = `'${repository.replace(/'/g, "''")}'`;
  await connection.query("SET autoinstall_known_extensions = false");
  await connection.query("SET autoload_known_extensions = false");
  await connection.query(`SET custom_extension_repository = ${literal}`);
  await connection.query(`SET autoinstall_extension_repository = ${literal}`);
  try {
    await connection.query("LOAD parquet");
  } catch (cause) {
    throw new Error("本地 Parquet 扩展加载失败，请检查前端部署是否包含 duckdb-extensions 目录", { cause });
  }
}
