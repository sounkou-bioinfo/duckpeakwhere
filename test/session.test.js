import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { openBrowser } from "./browser.js";

let browser, page;
before(async () => {
  browser = await openBrowser();
  page = await browser.newPage("/test/harness.html");
  await page.waitForFunction(() => !!window.runSession);
});
after(() => browser.close());

test("session invalidates only dependent tables and shares peak reads across views", async () => {
  const runs = await page.evaluate(async () => {
    const url = (p) => new URL(`/test/fixtures/${p}`, location.href).href;
    const a = { url: url("peaks.bed"), label: "a" }, b = { url: url("peaks-nochr.bed"), label: "b" };
    const request = { annotation: url("fixture.gff3"), peaks: [a], settings: {} };
    const runs = {};
    async function run(name, view = "where") {
      const result = await window.runSession(view, request);
      runs[name] = { result, sql: window.takeQueries().join("\n") };
    }
    await run("first");
    request.settings.mode = "bp";
    await run("mode");
    request.settings.promoterUpstream = 2000;
    await run("promoter");
    request.settings.proteinCodingOnly = true;
    await run("coding");
    request.peaks.push(b);
    await run("add");
    request.peaks = [b];
    await run("remove", "peek");
    request.peaks = [a, b];
    await run("replace");
    request.annotation = url("fixture.gtf");
    await run("annotation");
    await window.clearSession();
    runs.tables = await window.query("SELECT table_name FROM duckdb_tables() WHERE temporary");
    runs.plans = window.takePlans();
    return runs;
  });
  assert.equal((runs.first.sql.match(/FROM read_bed\(/g) ?? []).length, 1);
  assert.match(runs.first.sql, /FROM read_gff\(/);
  assert.match(runs.first.sql, /read_hts_header/);
  for (const name of ["mode", "promoter", "coding", "remove"]) {
    assert.doesNotMatch(runs[name].sql, /read_bed|read_gff|read_gtf|read_hts_header/);
  }
  assert.doesNotMatch(runs.mode.sql, /CREATE OR REPLACE TEMP TABLE/);
  for (const name of ["promoter", "coding"]) {
    assert.match(runs[name].sql, /CREATE OR REPLACE TEMP TABLE category_interval/);
    assert.doesNotMatch(runs[name].sql, /CREATE OR REPLACE TEMP TABLE (feature|part |tx )/);
  }
  for (const name of ["add", "replace"]) {
    assert.equal((runs[name].sql.match(/FROM read_bed\(/g) ?? []).length, 1);
    assert.doesNotMatch(runs[name].sql, /read_gff|read_hts_header|CREATE OR REPLACE TEMP TABLE category_interval/);
  }
  assert.equal(runs.remove.result.results[0].n, 17, "stable, non-contiguous file IDs work in Peek");
  assert.equal(runs.remove.result.results[0].histogram.reduce((n, b) => n + b.n, 0), 17);
  assert.match(runs.annotation.sql, /FROM read_gtf\(/);
  assert.doesNotMatch(runs.annotation.sql, /read_bed/);
  assert.deepEqual(runs.tables, []);
  assert.equal(runs.plans.length, 1);
  assert.match(runs.plans[0], /BLOCKWISE_NL_JOIN/);
  assert.match(runs.plans[0], /peek_bin_grid/);
  assert.match(runs.plans[0], /peek_valid/);
});

test("percent-encoded and plain Parent links share a multi-parent exon", async () => {
  const got = await page.evaluate(async () => {
    const base = `${location.origin}/test/fixtures/`;
    await window.clearSession();
    const result = await window.runSession("where", { annotation: `${base}encoded.gff3`,
      peaks: [{ url: `${base}peek/accepted.bed`, label: "p" }] });
    const parts = await window.query("SELECT tx, s, e FROM part ORDER BY tx");
    return { transcripts: result.meta.transcripts, parts };
  });
  assert.equal(got.transcripts, 2);
  assert.deepEqual(got.parts, [{ tx: "tx%one", s: 100n, e: 200n }, { tx: "tx-two", s: 100n, e: 200n }]);
});

test("cached counts equal uncached analyses for each settings change", async () => {
  await page.evaluate(() => window.clearSession());
  const pairs = await page.evaluate(async () => {
    const base = `${location.origin}/test/fixtures/`;
    const request = { annotation: `${base}fixture.gff3`, peaks: [{ url: `${base}peaks.bed`, label: "p" }] };
    const settings = [{}, { mode: "bp" }, { promoterUpstream: 2000 }, { proteinCodingOnly: true }];
    const cached = [];
    for (const s of settings) cached.push(await window.runSession("where", { ...request, settings: s }));
    await window.clearSession();
    const uncached = [];
    for (const s of settings) uncached.push(await window.annotateUrls({ ...request, settings: s }));
    return { cached, uncached };
  });
  assert.deepEqual(pairs.cached, pairs.uncached);
});
