
<!-- Render with `make head-to-head`; receipts come from bench/head-to-head-*.mjs. -->

# Head-to-head: duckpeakwhere vs upstream peakwhere

Status: measurement receipt for [issue
\#1](https://github.com/sounkou-bioinfo/duckpeakwhere/issues/1)’s
follow-up, taken on 2026-09-23. It checks upstream’s README claims (“2.9
s”, “re-draws in under half a second”, “matches bedtools”) on one
machine, with the same inputs and browser.

- **Upstream:**
  [seandavi/peakwhere](https://github.com/seandavi/peakwhere) at
  `f40a673842815b9eef08c4d32243b29dac3e0646`
  (`node bench/stage-upstream.mjs`), served as committed and driven
  through its real file inputs.
- **duckpeakwhere:** `develop` at `5fa746b` (per-key attribute
  extraction, \#8), signed DuckHTS 1.5.2, W2 files over same-origin
  HTTP.
- **Inputs (W2):** GENCODE vM25 basic (full), plus the full ENCODE
  thymus narrowPeak files ENCFF714WDP, ENCFF979ULB, ENCFF478UYW,
  ENCFF853BYO, ENCFF674JZY (hash-pinned in `bench/manifest.json`).
  Default settings: promoter −1000/+1000, peak centres, all transcripts.
- **Machine:** 13th Gen Intel Core i5-13500 (20 logical CPUs), headless
  Chromium 148.0.7778.96. One warm-up plus five timed runs per tool,
  each run in a fresh browser context, the tools run one after the
  other.

## Seconds, median \[min–max\] of five runs

| step                           |           upstream |      duckpeakwhere |
|:-------------------------------|-------------------:|-------------------:|
| Database + DuckHTS startup     |                  — | 0.66 \[0.64–0.69\] |
| First analysis (Run → results) | 4.35 \[4.34–4.38\] | 6.59 \[6.52–6.69\] |
| Redraw: centres → base pairs   | 0.53 \[0.51–0.54\] | 7.18 \[7.11–7.32\] |
| Redraw: promoter upstream 2000 | 0.49 \[0.48–0.51\] | 6.26 \[6.21–6.53\] |

Upstream re-runs 300 ms after a setting change (`src/app.js`), so its
redraw times include that debounce. duckpeakwhere at this commit re-runs
the whole analysis, re-reading the annotation. Neither tool sent a
request outside its own origin in any run.

## Agreement

| file     | identical_categories |  of |
|:---------|---------------------:|----:|
| CTCF     |                    6 |   6 |
| DNase    |                    6 |   6 |
| H3K27me3 |                    6 |   6 |
| H3K36me3 |                    6 |   6 |
| H3K4me3  |                    6 |   6 |

All 30 per-category peak-centre counts are identical between the two
implementations, which share no code. The report stops rendering if any
differ.

## Reading

- **“2.9 s”**: not reproduced on this machine (median 4.35 s). It was
  reported on other hardware, so this is not evidence the claim is
  false, only that it does not transfer.
- **“Under half a second”**: about right; roughly 0.2 s of compute after
  the 0.3 s debounce.
- **Gap to close**: duckpeakwhere’s first analysis is 1.5× upstream’s,
  and its redraws re-read everything. The first is tracked in
  [duckhts#249](https://github.com/RGenomicsETL/duckhts/issues/249); the
  second is session caching.
