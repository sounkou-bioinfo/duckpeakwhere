// Download the signed DuckHTS wasm builds named in duckhts-manifest.json into
// vendor/duckhts/<platform>/, refusing any file whose sha256 differs from the manifest.
// This is the only script that touches the network; the app itself never does.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile("duckhts-manifest.json", "utf8"));

for (const [platform, expected] of Object.entries(manifest.files)) {
  const url = manifest.source.replace("{platform}", platform);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    throw new Error(`${url}: sha256 ${actual}, manifest says ${expected}`);
  }
  await mkdir(`vendor/duckhts/${platform}`, { recursive: true });
  await writeFile(`vendor/duckhts/${platform}/duckhts.duckdb_extension.wasm`, bytes);
  console.log(`${platform}: ${bytes.length} bytes, sha256 ok`);
}
