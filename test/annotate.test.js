// The SQL pipeline against the hand-built fixture. expected.json was written by hand in
// peakwhere (seandavi/peakwhere, test/fixtures) before any code existed: it is the oracle.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { openBrowser } from "./browser.js";

const expected = JSON.parse(await readFile(new URL("./fixtures/expected.json", import.meta.url), "utf8"));
const CATEGORIES = ["promoter", "utr5", "utr3", "exon", "intron", "intergenic"];
const pick = (o) => Object.fromEntries(CATEGORIES.map((c) => [c, o[c]]));

let session;
let page;
before(async () => {
  session = await openBrowser();
  page = await session.newPage("/test/harness.html");
});
after(() => session.close());

const annotate = (request) => page.evaluate((r) => window.annotateUrls(r), request);
const fixture = (name) => `/test/fixtures/${name}`;
const peaks = [{ url: fixture("peaks.bed"), label: "peaks" }];

test("signed DuckHTS loads with unsigned extensions disallowed", async () => {
  const info = await page.evaluate(() => window.databaseInfo());
  assert.equal(info.unsigned, "false");
  assert.match(info.platform, /^wasm_/);
});

for (const annotation of ["fixture.gff3", "fixture.gtf"]) {
  test(`${annotation}: peak centres`, async () => {
    const { results } = await annotate({ annotation: fixture(annotation), peaks });
    const [r] = results;
    assert.deepEqual(r.counts, pick(expected.counts_centre));
    assert.equal(r.peaks.matched, expected.counts_centre.matched);
    assert.equal(r.peaks.unmatched, expected.counts_centre.unmatched);
    assert.deepEqual(r.unmatchedChroms, expected.counts_centre.unmatchedChroms);
  });

  test(`${annotation}: peak base pairs`, async () => {
    const { results } = await annotate({ annotation: fixture(annotation), peaks, settings: { mode: "bp" } });
    assert.deepEqual(results[0].counts, pick(expected.basepairs));
    assert.equal(results[0].matched, expected.basepairs.matched);
  });
}

test("fixture.gff3: genome background from ##sequence-region", async () => {
  const { background } = await annotate({ annotation: fixture("fixture.gff3"), peaks });
  assert.deepEqual(background.counts, pick(expected.genomeBackground_bp));
  assert.equal(background.total, expected.genomeBackground_bp.total);
});

test("fixture.gtf: no lengths, so no genome background", async () => {
  const { background, warnings } = await annotate({ annotation: fixture("fixture.gtf"), peaks });
  assert.equal(background, null);
  assert.ok(warnings.some((w) => /Genome bar is hidden/.test(w)));
});

test("chromosome names match without the chr prefix", async () => {
  const { results } = await annotate({
    annotation: fixture("fixture.gff3"),
    peaks: [{ url: fixture("peaks-nochr.bed"), label: "nochr" }],
  });
  assert.deepEqual(results[0].counts, pick(expected.counts_centre));
});

// Known limitation, https://github.com/RGenomicsETL/duckhts/issues/246: htslib opens
// paths itself, so it can't see files registered with duckdb-wasm, and it has no
// handler for blob: URLs. When this test fails, dropped files can be supported.
test("DuckHTS cannot yet read registered files or blob: URLs", async () => {
  const probe = await page.evaluate((p) => window.probeLocalFile(p), fixture("peaks.bed"));
  assert.equal(probe.coreReader, 17, "DuckDB's own reader sees the registered file");
  assert.equal(probe.registered.ok, false);
  assert.match(probe.registered.error, /failed to open file/);
  assert.equal(probe.blobUrl.ok, false);
  assert.match(probe.blobUrl.error, /failed to open file/);
});

test("no request leaves the origin", () => {
  const foreign = session.requests.filter((u) => !u.startsWith(session.base));
  assert.deepEqual(foreign, []);
});
