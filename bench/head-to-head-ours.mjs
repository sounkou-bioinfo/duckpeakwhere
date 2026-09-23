// Head-to-head: duckpeakwhere on W2 in headless Chromium: database + DuckHTS startup,
// first analysis, and the same two setting changes upstream is timed on.
// Run from the repository root: node bench/head-to-head-ours.mjs <runs> <out.json>
import { writeFile } from "node:fs/promises";
import { openBrowser } from "../test/browser.js";

const runs = Number(process.argv[2] ?? 6);
const out = process.argv[3];
const peaks = ["CTCF_ENCFF714WDP", "DNase_ENCFF979ULB", "H3K27me3_ENCFF478UYW", "H3K36me3_ENCFF853BYO", "H3K4me3_ENCFF674JZY"];
const results = [];
for (let i = 0; i < runs; i++) {
  const session = await openBrowser();
  try {
    const page = await session.newPage("/bench/harness.html");
    const r = await page.evaluate(async ({ base, peaks }) => {
      const { openDatabase } = await import("/src/db.js");
      const { annotate } = await import("/src/annotate.js");
      const t0 = performance.now();
      const { conn } = await openDatabase();
      const t1 = performance.now();
      const request = {
        annotation: `${base}/bench/.cache/W2/gencode.vM25.basic.annotation.gff3.gz`,
        peaks: peaks.map((p) => ({ url: `${base}/bench/.cache/W2/thymus_${p}.narrowPeak.gz`, label: p.split("_")[0] })),
      };
      const first = await annotate(conn, request);
      const t2 = performance.now();
      await annotate(conn, { ...request, settings: { mode: "bp" } });
      const t3 = performance.now();
      await annotate(conn, { ...request, settings: { promoterUpstream: 2000 } });
      const t4 = performance.now();
      const counts = Object.fromEntries(first.results.map((x) => [x.label, x.counts]));
      return { startup: (t1 - t0) / 1000, run: (t2 - t1) / 1000,
               redraw: { mode_bp: (t3 - t2) / 1000, promoter_2000: (t4 - t3) / 1000 }, counts };
    }, { base: session.base, peaks });
    const offsite = session.requests.filter((u) => !u.startsWith(session.base));
    results.push({ i, warmup: i === 0, ...r, offsite });
    console.log(JSON.stringify({ i, startup: r.startup, run: r.run, redraw: r.redraw, offsite: offsite.length }));
  } finally {
    await session.close();
  }
}
await writeFile(out, JSON.stringify(results, null, 1));
