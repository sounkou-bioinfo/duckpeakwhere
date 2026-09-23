import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readme = await readFile("README.Rmd", "utf8");

test("README describes optional Downstream and summit counting next to chrom.sizes", () => {
  const options = readme.slice(readme.indexOf("For annotations without `##sequence-region`"),
    readme.indexOf("Reading `blob:`"));
  assert.match(options, /Downstream.*off by default/s);
  assert.match(options, /TES.*positive.*negative.*strand/s);
  assert.match(options, /Intron.*Downstream.*Intergenic/s);
  assert.match(options, /narrowPeak.*summit.*off by default/s);
  assert.match(options, /missing or out-of-range.*midpoint/s);
});

test("README offers two live-console SQL examples", () => {
  const section = readme.slice(readme.indexOf("## Try the SQL"), readme.indexOf("## The same SQL"));
  assert.match(section, /SQL console/);
  assert.match(section, /SELECT count\(\*\) AS transcripts FROM tx;/);
  assert.match(section, /SELECT fid, count\(\*\) AS peaks FROM peak/);
});
