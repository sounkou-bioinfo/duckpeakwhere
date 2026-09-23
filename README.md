# duckpeakwhere

**Where do your peaks land?** Split ChIP-seq, CUT&RUN and ATAC-seq peaks into promoter,
5′ UTR, 3′ UTR, exon, intron and intergenic space, with a genome background bar, in the
browser.

This is a port of [peakwhere](https://github.com/seandavi/peakwhere) by Sean Davis. It
keeps peakwhere's biological rules and its hand-worked test fixture, but replaces its
hand-written GFF3/GTF parser and planned overlap engine with SQL over
[DuckHTS](https://github.com/RGenomicsETL/duckhts) running in
[duckdb-wasm](https://github.com/duckdb/duckdb-wasm).

## How it works

Everything is in [`src/annotate.js`](src/annotate.js), one SQL statement per step:

| Step | peakwhere | here |
|---|---|---|
| Read GFF3 / GTF / BED | hand-written streaming parser | `read_gff`, `read_gtf`, `read_bed` (htslib) |
| Chromosome names (`chr1` = `1`, `M` = `MT`) | JavaScript | `duckhts_contig_key` |
| Transcripts, UTRs, promoter windows | JavaScript model | plain SQL over the feature table |
| Priority partition | planned sorted-segment engine | cut points in SQL; each segment's category from a DuckHTS cgranges index |
| Peak centres, base pairs, genome background | binary search per peak | `duckhts_cgranges_overlaps_list` against the partition |

The rules are peakwhere's: promoter ±1 kb around the TSS base, counted on the strand;
priority Promoter > 5′ UTR > 3′ UTR > Exon > Intron > Intergenic; one count per peak
centre, or per base pair; unmatched chromosomes reported, and a file with more than 5%
unmatched peaks not drawn; the genome background taken from GFF3 `##sequence-region`
lengths.

The page makes no requests outside its own origin. duckdb-wasm, Observable Plot and the
signed DuckHTS builds are served from `vendor/`.

## Limitations

- **Bundled files only.** DuckHTS readers open paths through htslib, which can't see
  files registered with duckdb-wasm (`registerFileBuffer`, `registerFileHandle`) and
  has no handler for `blob:` URLs. So a file dropped on the page can't be read yet. The
  demo reads its example files over same-origin HTTP instead. A test in
  `test/annotate.test.js` records this, and will fail once it changes. Tracked in
  [duckhts#246](https://github.com/RGenomicsETL/duckhts/issues/246).
- **DuckDB 1.5 runtime required.** DuckHTS 1.5.2 does not initialise on the current
  stable duckdb-wasm (1.32.0, DuckDB v1.4.3). Its Somalier macros refer to
  `read_hts_header` before that function is registered on that runtime. So this pins
  `@duckdb/duckdb-wasm` 1.33.1-dev57.0 (DuckDB v1.5.4).
- Not ported from peakwhere: chrom.sizes input, CSV/TSV peak input with its 1-based
  toggle, and editable bar labels.

## Run it

```bash
npm ci
npm run stage    # download the signed DuckHTS wasm builds, checked against duckhts-manifest.json
npm run vendor   # copy duckdb-wasm and Plot from node_modules into vendor/
npm run serve    # http://127.0.0.1:8000/
npm test         # headless Chromium, needs a Playwright Chromium install
```

`npm run stage` is the only step that uses the network. DuckHTS is built on the DuckDB
C API v1, so one build per wasm platform serves DuckDB ≥ v1.2.0 and < v2. Once the
`duckhts` npm package exists ([duckhts#246](https://github.com/RGenomicsETL/duckhts/issues/246)),
it will replace both the staging script and `src/duckhts-loader.js`.

## Tests

- `test/annotate.test.js`: the SQL pipeline against peakwhere's
  [`expected.json`](test/fixtures/expected.json). Those answers were worked out by hand
  before any peakwhere code existed. Covers GFF3 and GTF, peak centres and base pairs,
  the genome background, and `chr`-less names.
- `test/app.test.js`: the page end to end. It checks the fixture, and the mouse thymus
  example against [`thymus-expected.json`](test/fixtures/thymus-expected.json), which
  comes from [`test/oracle.py`](test/oracle.py), a slow brute-force implementation
  that shares no code with the SQL.
- Both check that the signed DuckHTS build loads with unsigned extensions disallowed,
  and that no request leaves the origin.

Example data: GENCODE and ENCODE, see [`examples/README.md`](examples/README.md).

MIT licensed. See [`LICENSE`](LICENSE).
