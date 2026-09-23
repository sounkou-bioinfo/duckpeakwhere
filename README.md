
<!-- README.md is generated from README.Rmd with `make readme`. Please edit that file. -->

# duckpeakwhere <img src="man/figures/logo.svg" align="right" height="139" alt="duckpeakwhere hex sticker" />

[![test](https://github.com/sounkou-bioinfo/duckpeakwhere/actions/workflows/test.yml/badge.svg)](https://github.com/sounkou-bioinfo/duckpeakwhere/actions/workflows/test.yml)

**Where do your peaks land?** Split ChIP-seq, CUT&RUN and ATAC-seq peaks
into promoter, 5′ UTR, 3′ UTR, exon, intron and intergenic space, with a
genome background bar, in the browser.

This is a port of [peakwhere](https://github.com/seandavi/peakwhere) by
Sean Davis. It keeps peakwhere’s biological rules and its hand-worked
test fixture, but replaces its hand-written GFF3/GTF parser and planned
overlap engine with SQL over
[DuckHTS](https://github.com/RGenomicsETL/duckhts) running in
[duckdb-wasm](https://github.com/duckdb/duckdb-wasm).

## How it works

Everything is in [`src/annotate.js`](src/annotate.js), one SQL statement
per step:

| Step                                        | peakwhere                     | here                                                                     |
|---------------------------------------------|-------------------------------|--------------------------------------------------------------------------|
| Read GFF3 / GTF / BED                       | hand-written streaming parser | `read_gff`, `read_gtf`, `read_bed` (htslib)                              |
| Chromosome names (`chr1` = `1`, `M` = `MT`) | JavaScript                    | `duckhts_contig_key`                                                     |
| Transcripts, UTRs, promoter windows         | JavaScript model              | plain SQL over the feature table                                         |
| Priority partition                          | planned sorted-segment engine | cut points in SQL; each segment’s category from a DuckHTS cgranges index |
| Peak centres, base pairs, genome background | binary search per peak        | `duckhts_cgranges_overlaps_list` against the partition                   |

The rules are peakwhere’s:

- Promoter is ±1 kb around the TSS base, counted on the strand.
- Priority is Promoter \> 5′ UTR \> 3′ UTR \> Exon \> Intron \>
  Intergenic.
- One count per peak centre, or per base pair.
- Unmatched chromosomes are reported, and a file with more than 5%
  unmatched peaks is not drawn.
- The genome background comes from GFF3 `##sequence-region` lengths.

The page makes no requests outside its own origin. duckdb-wasm,
Observable Plot and the signed DuckHTS builds are served from `vendor/`.

## The same SQL, outside the browser

Nothing in the SQL is browser-specific. These chunks run in the DuckDB
CLI against the bundled example data, with the same DuckHTS extension.

The files are read whole, so the readers use
`scan_mode := 'sequential'`, which streams without looking for a tabix
index. Here is the annotation as `read_gff` sees it:

``` sql
SELECT feature, count(*) AS n
FROM read_gff('examples/gencode.vM25.basic.chr19.gff3.gz', scan_mode := 'sequential')
GROUP BY feature
ORDER BY n DESC, feature
LIMIT 6;
#> ┌─────────────────┬───────┐
#> │     feature     │   n   │
#> │     varchar     │ int64 │
#> ├─────────────────┼───────┤
#> │ exon            │ 17082 │
#> │ CDS             │ 14404 │
#> │ five_prime_UTR  │  2429 │
#> │ transcript      │  2303 │
#> │ three_prime_UTR │  1577 │
#> │ start_codon     │  1553 │
#> └─────────────────┴───────┘
```

The peak files, read by `read_bed` straight from gzip:

``` sql
SELECT 'CTCF' AS mark, count(*) AS peaks, median("end" - start) AS median_width
FROM read_bed('examples/thymus_CTCF_ENCFF714WDP.chr19.narrowPeak.gz', scan_mode := 'sequential')
UNION ALL
SELECT 'H3K4me3', count(*), median("end" - start)
FROM read_bed('examples/thymus_H3K4me3_ENCFF674JZY.chr19.narrowPeak.gz', scan_mode := 'sequential');
#> ┌─────────┬───────┬──────────────┐
#> │  mark   │ peaks │ median_width │
#> │ varchar │ int64 │    double    │
#> ├─────────┼───────┼──────────────┤
#> │ CTCF    │   706 │        344.0 │
#> │ H3K4me3 │   859 │        648.0 │
#> └─────────┴───────┴──────────────┘
```

And the chromosome names the two files use are matched by key, not by
string:

``` sql
SELECT duckhts_contig_key('chr19') = duckhts_contig_key('19') AS same_contig,
       duckhts_contig_key('chrM') = duckhts_contig_key('MT') AS same_mito;
#> ┌─────────────┬───────────┐
#> │ same_contig │ same_mito │
#> │   boolean   │  boolean  │
#> ├─────────────┼───────────┤
#> │ true        │ true      │
#> └─────────────┴───────────┘
```

## Results on the example

Peak-centre counts for the mouse thymus chr19 example, from the
independent R oracle [`test/oracle.R`](test/oracle.R). The app’s
end-to-end test requires the page to reproduce every number:

|          | promoter | utr5 | utr3 | exon | intron | intergenic |
|:---------|---------:|-----:|-----:|-----:|-------:|-----------:|
| CTCF     |      360 |    0 |   15 |   28 |    192 |        111 |
| DNase    |      893 |    1 |   47 |   60 |    732 |        462 |
| H3K27me3 |      233 |    1 |   13 |   29 |    148 |        181 |
| H3K36me3 |       96 |    5 |  226 |  440 |   2007 |         81 |
| H3K4me3  |      594 |    1 |    8 |   30 |    148 |         78 |

## Performance

Local W1 (7,220 thymus chr19 peaks) and W2 (full-genome versions of the
same files) analysis totals in seconds, **median \[min–max\]** of five
runs after one warm-up. A failed workload has no reported timings.
Native replays the app’s exact SQL over the same local HTTP inputs;
ChIPseeker uses one-base peak centres but has different annotation
rules, so these are not equal-output speedups. Startup-inclusive times,
correctness gates, category differences, environment and reproduction
commands are in the [performance report](benchmarks/performance.md). W1
matches the independent fixture; W2 has exact three-engine SQL
agreement, but its oracle timed out at 120 seconds and has a
chromosome-scope limitation described in the report.

| Workload | wasm                     | native-1t             | native-nt             | chipseeker               |
|:---------|:-------------------------|:----------------------|:----------------------|:-------------------------|
| W1       | 0.728 \[0.720–0.765\]    | 0.401 \[0.390–0.405\] | 0.370 \[0.368–0.380\] | 2.776 \[2.645–3.009\]    |
| W2       | 13.623 \[13.568–13.704\] | 9.699 \[9.655–9.758\] | 7.395 \[7.385–7.444\] | 25.782 \[25.746–25.805\] |

## Limitations

- **Bundled files only.** DuckHTS readers open paths through htslib,
  which can’t see files registered with duckdb-wasm
  (`registerFileBuffer`, `registerFileHandle`) and has no handler for
  `blob:` URLs. So a file dropped on the page can’t be read yet. The
  demo reads its example files over same-origin HTTP instead. A test in
  `test/annotate.test.js` records this, and will fail once it changes.
  Tracked in
  [duckhts#246](https://github.com/RGenomicsETL/duckhts/issues/246).
- **DuckDB 1.5 runtime required.** DuckHTS 1.5.2 fails to load on the
  current stable duckdb-wasm (1.32.0, DuckDB v1.4.3), because it
  registers SQL that calls `read_hts_header` before registering that
  function
  ([duckhts#247](https://github.com/RGenomicsETL/duckhts/issues/247)).
  So this pins `@duckdb/duckdb-wasm` 1.33.1-dev57.0 (DuckDB v1.5.4).
- Not ported from peakwhere: chrom.sizes input, CSV/TSV peak input with
  its 1-based toggle, and editable bar labels.

## Run it

``` bash
npm ci
npm run stage    # download the signed DuckHTS wasm builds, checked against duckhts-manifest.json
npm run vendor   # copy duckdb-wasm and Plot from node_modules into vendor/
npm run serve    # http://127.0.0.1:8000/
npm test         # headless Chromium, needs a Playwright Chromium install
```

`npm run stage` is the only step that uses the network. Once the
`duckhts` npm package is published
([duckhts#248](https://github.com/RGenomicsETL/duckhts/pull/248)), it
will replace both the staging script and `src/duckhts-loader.js`.

## Tests

- `test/annotate.test.js` checks the SQL pipeline against peakwhere’s
  [`expected.json`](test/fixtures/expected.json). Those answers were
  worked out by hand before any peakwhere code existed. It covers GFF3
  and GTF, peak centres and base pairs, the genome background, and
  `chr`-less names.
- `test/app.test.js` checks the page end to end: the fixture, and the
  thymus example against
  [`thymus-expected.json`](test/fixtures/thymus-expected.json) from
  [`test/oracle.R`](test/oracle.R). The oracle is a slow brute-force
  implementation in base R that shares no code with the SQL.
- Both check that the signed DuckHTS build loads with unsigned
  extensions disallowed, and that no request leaves the origin.
- CI reruns the oracle and fails if its output differs from the
  committed expectations.

House rules for contributors and agents are in [`AGENTS.md`](AGENTS.md).
Example data comes from GENCODE and ENCODE; see
[`examples/README.md`](examples/README.md).

MIT licensed. See [`LICENSE`](LICENSE).
