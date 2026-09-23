// Load the DuckHTS extension into a duckdb-wasm connection from a URL the app serves.
//
// This is the interface the `duckhts` npm package is planned to export
// (https://github.com/RGenomicsETL/duckhts/issues/246). Until it is published, this
// copy lives here and scripts/vendor.mjs copies it to vendor/duckhts-loader.js.
//
// `baseUrl` holds one signed build per platform: `${baseUrl}/${platform}/duckhts.duckdb_extension.wasm`.
// DuckHTS uses the DuckDB C API v1, so one build serves every DuckDB >= v1.2.0 and < v2.

const WASM_PLATFORMS = new Set(["wasm_mvp", "wasm_eh", "wasm_threads"]);

/**
 * @param {import("@duckdb/duckdb-wasm").AsyncDuckDBConnection} conn
 * @param {{baseUrl: string}} options
 * @returns {Promise<{platform: string}>}
 */
export async function loadDuckhts(conn, { baseUrl }) {
  const result = await conn.query("PRAGMA platform");
  const platform = String(result.getChildAt(0).get(0));
  if (!WASM_PLATFORMS.has(platform)) {
    throw new Error(
      `DuckHTS wasm builds exist for ${[...WASM_PLATFORMS].join(", ")}; this DuckDB reports "${platform}".`,
    );
  }
  const url = new URL(`${platform}/duckhts.duckdb_extension.wasm`, `${baseUrl.replace(/\/?$/, "/")}`);
  await conn.query(`LOAD '${url.href.replaceAll("'", "''")}'`);
  return { platform };
}
