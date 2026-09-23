
<!-- Render with `make performance`; timing receipts come from `Rscript bench/run.R`. -->

# Performance comparison

[Issue \#1](https://github.com/sounkou-bioinfo/duckpeakwhere/issues/1)
compares [duckpeakwhere](../README.md)’s SQL in duckdb-wasm and native
DuckDB with ChIPseeker `annotatePeak`. Sean Davis’s peakwhere is not
timed: its `src/pipeline.js` is a stub. The independent base-R oracle is
a correctness reference, not a timing competitor. These are local
measurements, not CI benchmarks.

## Headline

Seconds, **median \[min–max\] of five runs**, after one discarded
warm-up. Total means the two analysis phases, excluding engine startup;
native totals sum DuckDB’s per-statement wall timers. See process wall
times below for startup-inclusive native and R measurements. ChIPseeker
performs additional nearest-transcript annotation and has different
category rules, so this is not an equal-output speedup claim.

| Workload | wasm                  | native-1t             | native-nt             | chipseeker            |
|:---------|:----------------------|:----------------------|:----------------------|:----------------------|
| W1       | 0.830 \[0.750–1.195\] | 0.515 \[0.431–0.624\] | 0.384 \[0.361–0.525\] | 3.148 \[2.853–4.453\] |

W1 contains all 7,220 bundled mouse thymus chr19 peaks in five files,
against GENCODE M25 basic chr19 (mm10/GRCm38). W2 uses the full versions
of those same GENCODE and ENCODE files; only workloads with receipts are
tabulated.

## Reproduce

From the repository root, with the app’s vendor files staged, the DuckDB
CLI, `/usr/bin/time`, headless Chromium, and R packages ChIPseeker,
txdbmaker, GenomicFeatures, jsonlite, processx, BiocManager, knitr and
rmarkdown installed:

``` bash
node bench/stage.mjs W1
Rscript bench/run.R W1
make performance
make readme
```

[`bench/manifest.json`](../bench/manifest.json) pins the signed native
DuckHTS archive URL and SHA-256. Staging verifies the compressed bytes
on every invocation and extracts to `duckhts.duckdb_extension` (the
basename determines the init symbol). Downloads stay in ignored
`bench/.cache/`. [`results.json`](results.json) contains per-run
receipts, including the discarded warm-up, counts, source/input
SHA-256s, versions, native statement timings and `/usr/bin/time -v`
output. Native reports DuckHTS 1.5.2 in `duckdb_extensions()`. That
version field is blank in wasm, whose release identity is instead
established by checking the staged artifact against
`duckhts-manifest.json`’s pinned SHA-256 before every run. Rendering
reads these receipts; it does not rerun engines or download data.

## Measurement contract

- One warm-up and five measured runs per workload and engine, in fixed
  order: wasm, native-1t, native-nt, ChIPseeker. Each native/R run is a
  fresh process; each wasm run is a fresh page (and browser). OS caches
  are not flushed. Engines run serially. Each engine has a 600-second
  wall limit, including warm-up.
- Browser timing uses `performance.now()` at phase boundaries in the
  actual `annotate()` call. Phase **partition** starts before annotation
  header reading and includes feature/category construction and the
  partition index. Phase **count** includes all five peak files,
  chromosome diagnostics, genome background, metadata queries and index
  destruction, exactly as in the app. Rendering and database/extension
  startup are excluded.
- The browser captures the SQL issued by `src/annotate.js`. Native
  replays that text, rather than maintaining a SQL copy. The three
  engines’ statement/phase SHA-256s must match for each repetition.
  Native uses the **same local HTTP URLs** while the browser’s server
  remains alive; thus path literals also match exactly. No remote
  requests occur during analysis. Native local-file performance is not
  measured. Whole-file DuckHTS reads use `scan_mode := 'sequential'`.
- Native **partition/count/total** sum CLI `.timer on` real seconds per
  statement (printed at millisecond precision; small statements can
  round to zero). CLI stdout is retained: it includes the
  deprecated-lambda warning from the app SQL. Only the non-empty
  priority/count result sets are parsed for the native gate.
  **process_wall** measures the entire `/usr/bin/time ... duckdb`
  invocation, including loading, transport, CLI JSON serialization, and
  shutdown. The native SQL thread setting is either 1 or the CLI
  default; it is recorded, not assumed.
- ChIPseeker **partition** is GFF3 → TxDb; **count** reads the five BED
  files, constructs one-base centres, calls `annotatePeak`, and
  tabulates categories. **total** sums those phases. Package loading is
  outside analysis total but inside **process_wall**, which covers the
  fresh Rscript invocation and receipt writing. Annotation feature
  caches are shared across the five files within one run only.
- Native and R peak RSS come from `/usr/bin/time -v`, over the whole
  process. Browser memory is **not measured**. The host is shared with
  unrelated processes, with no CPU affinity or exclusive reservation.
  This single-machine, fixed-order sample has no confidence intervals
  and does not isolate CPU kernels from I/O or startup.

## Correctness gates and measurements

No workload timing is published unless all of its SQL correctness gates
pass. Every run, including warm-up, is checked. W1 requires the six
counts for each file to equal `test/fixtures/thymus-expected.json`
exactly, with zero unmatched peaks; `test/oracle.R` must reproduce that
fixture byte for byte. ChIPseeker is not required to match SQL: input
totals, recognized category labels, and repeatability are checked, with
dropped peaks reported separately. Its disagreement is never used to
relax the SQL gate.

### W1

Every SQL run exactly matches thymus-expected.json; identical SQL hashes
across engines; ChIPseeker counts stable and input totals verified.

Oracle: passed; limit 600 seconds.

| Engine     | Phase        | Seconds: median \[min–max\] |
|:-----------|:-------------|:----------------------------|
| wasm       | partition    | 0.720 \[0.634–1.036\]       |
| wasm       | count        | 0.137 \[0.110–0.158\]       |
| wasm       | total        | 0.830 \[0.750–1.195\]       |
| native-1t  | partition    | 0.472 \[0.371–0.561\]       |
| native-1t  | count        | 0.062 \[0.040–0.063\]       |
| native-1t  | total        | 0.515 \[0.431–0.624\]       |
| native-1t  | process_wall | 0.571 \[0.496–0.688\]       |
| native-nt  | partition    | 0.326 \[0.310–0.435\]       |
| native-nt  | count        | 0.058 \[0.051–0.105\]       |
| native-nt  | total        | 0.384 \[0.361–0.525\]       |
| native-nt  | process_wall | 0.449 \[0.418–0.647\]       |
| chipseeker | partition    | 1.484 \[1.275–1.665\]       |
| chipseeker | count        | 1.873 \[1.518–2.788\]       |
| chipseeker | total        | 3.148 \[2.853–4.453\]       |
| chipseeker | process_wall | 10.857 \[9.455–12.493\]     |

| Engine     | Peak RSS MiB: median \[min–max\] |
|:-----------|:---------------------------------|
| wasm       | not measured                     |
| native-1t  | 178.9 \[178.5–179.5\]            |
| native-nt  | 327.9 \[295.2–335.9\]            |
| chipseeker | 1197.9 \[1197.4–1199.1\]         |

## ChIPseeker agreement

Configuration: ChIPseeker 1.48.0; TxDb constructed from the **same
GFF3**; `level = 'transcript'`; `tssRegion = c(-1000, 1000)`;
`genomicAnnotationPriority = c('Promoter', '5UTR', '3UTR', 'Exon', 'Intron', 'Intergenic')`;
`ignoreDownstream = TRUE`. A BED interval `[s,e)` becomes a one-base
GRanges interval at `s + (e-s) %/% 2 + 1` (one-based). There is no
summit-based or whole-peak counting.

Relevant rule differences, checked in the installed ChIPseeker functions
`annotatePeak`, `getNearestFeatureIndicesAndDistances` and
`getGenomicAnnotation`:

- Both use transcript-level features here; **gene-level TSS is not the
  chosen setting**. SQL assigns promoter if *any* eligible transcript’s
  ±1 kb interval contains the centre. ChIPseeker assigns promoter from
  its selected nearest-feature distance. In 1.48.0,
  `ignoreDownstream=TRUE` selects the `follow()` candidate on unstranded
  genomic coordinates (with TSS-overlap handling), not the minimum
  absolute distance of the two flanking TSS candidates. This can change
  promoters.
- `ignoreDownstream` does **not** disable downstream output labels.
  ChIPseeker’s category function still labels remaining intergenic
  centres within its default 3 kb downstream distance. Those labels are
  explicitly folded into **intergenic**; the number folded is shown
  below. SQL has no downstream category.
- SQL uses explicit GFF3 five/three-prime UTR features. TxDb represents
  CDS/exon structure and ChIPseeker obtains UTRs from
  `fiveUTRsByTranscript` and `threeUTRsByTranscript`; the annotation
  representations need not coincide.
- SQL treats transcript spans as intronic after higher-priority
  intervals are removed. ChIPseeker uses exon-gap introns from TxDb.
  TxDb transcript recognition and validation can differ from SQL’s rule
  (a transcript is a parent of an exon). Construction warnings and
  transcript counts are retained in the receipts.
- Exon and intron transcript IDs/numbers and promoter distance labels
  are collapsed to their six category names, not compared as strings.
  Neither engine filters protein-coding transcripts or requires peak
  strand. SQL normalizes contig names and reports unmatched chromosomes;
  ChIPseeker uses TxDb sequence names and may omit centres lacking
  usable features. Such omissions are reported, not imputed.

Differences below are **ChIPseeker − SQL**. These are marginal category
counts, not per-peak concordance: equal totals do not prove the same
peaks received a category. No individual discrepancy is claimed to have
been causally decomposed.

### W1

| Mark     | Category   |  SQL | ChIPseeker | ChIPseeker − SQL |
|:---------|:-----------|-----:|-----------:|-----------------:|
| CTCF     | promoter   |  360 |        215 |             -145 |
| CTCF     | utr5       |    0 |         27 |               27 |
| CTCF     | utr3       |   15 |         18 |                3 |
| CTCF     | exon       |   28 |         49 |               21 |
| CTCF     | intron     |  192 |        225 |               33 |
| CTCF     | intergenic |  111 |        172 |               61 |
| DNase    | promoter   |  893 |        532 |             -361 |
| DNase    | utr5       |    1 |         41 |               40 |
| DNase    | utr3       |   47 |         52 |                5 |
| DNase    | exon       |   60 |         99 |               39 |
| DNase    | intron     |  732 |        853 |              121 |
| DNase    | intergenic |  462 |        618 |              156 |
| H3K27me3 | promoter   |  233 |        127 |             -106 |
| H3K27me3 | utr5       |    1 |         15 |               14 |
| H3K27me3 | utr3       |   13 |         13 |                0 |
| H3K27me3 | exon       |   29 |         50 |               21 |
| H3K27me3 | intron     |  148 |        189 |               41 |
| H3K27me3 | intergenic |  181 |        211 |               30 |
| H3K36me3 | promoter   |   96 |         46 |              -50 |
| H3K36me3 | utr5       |    5 |          7 |                2 |
| H3K36me3 | utr3       |  226 |        230 |                4 |
| H3K36me3 | exon       |  440 |        452 |               12 |
| H3K36me3 | intron     | 2007 |       2039 |               32 |
| H3K36me3 | intergenic |   81 |         81 |                0 |
| H3K4me3  | promoter   |  594 |        346 |             -248 |
| H3K4me3  | utr5       |    1 |         42 |               41 |
| H3K4me3  | utr3       |    8 |         10 |                2 |
| H3K4me3  | exon       |   30 |         78 |               48 |
| H3K4me3  | intron     |  148 |        251 |              103 |
| H3K4me3  | intergenic |   78 |        132 |               54 |
| All      | promoter   | 2176 |       1266 |             -910 |
| All      | utr5       |    8 |        132 |              124 |
| All      | utr3       |  309 |        323 |               14 |
| All      | exon       |  587 |        728 |              141 |
| All      | intron     | 3227 |       3557 |              330 |
| All      | intergenic |  913 |       1214 |              301 |

| Mark     | Input | Dropped | Downstream folded to intergenic |
|:---------|------:|--------:|--------------------------------:|
| CTCF     |   706 |       0 |                               3 |
| DNase    |  2195 |       0 |                               6 |
| H3K27me3 |   605 |       0 |                               1 |
| H3K36me3 |  2855 |       0 |                              11 |
| H3K4me3  |   859 |       0 |                               0 |

SQL transcripts: 2303; TxDb transcripts: 2303.

## Environment and provenance

Source hashes in the receipts identify the measured working-tree files;
the Git revision alone is the base commit, not a claim that uncommitted
benchmark code was already part of that commit. Input hashes identify
the exact compressed files.

### W1

Measured: 2026-09-23 17:30:04 UTC

| Component           | Version                      |
|:--------------------|:-----------------------------|
| Node                | v24.14.1                     |
| duckdb-wasm package | 1.33.1-dev57.0               |
| wasm DuckDB         | v1.5.4                       |
| Chromium            | 148.0.7778.96                |
| wasm platform       | wasm_eh                      |
| native DuckDB       | v1.5.1                       |
| DuckHTS             | 1.5.2                        |
| R                   | R version 4.6.0 (2026-04-24) |
| Bioconductor        | 3.23                         |
| ChIPseeker          | 1.48.0                       |
| txdbmaker           | 1.8.0                        |
| GenomicFeatures     | 1.64.0                       |
| GenomicRanges       | 1.64.0                       |
| IRanges             | 2.46.0                       |
| rtracklayer         | 1.72.0                       |

Threads: wasm 1; native-1t 1; native-nt 20. Signed DuckHTS loaded with
`allow_unsigned_extensions=false` in all SQL engines.

``` text
CPU(s):                               20
Model name:                           13th Gen Intel(R) Core(TM) i5-13500
Thread(s) per core:                   2
Core(s) per socket:                   14
Socket(s):                            1
PRETTY_NAME="Ubuntu 24.04.3 LTS"
NAME="Ubuntu"
VERSION_ID="24.04"
VERSION="24.04.3 LTS (Noble Numbat)"
VERSION_CODENAME=noble
ID=ubuntu
ID_LIKE=debian
HOME_URL="https://www.ubuntu.com/"
SUPPORT_URL="https://help.ubuntu.com/"
BUG_REPORT_URL="https://bugs.launchpad.net/ubuntu/"
PRIVACY_POLICY_URL="https://www.ubuntu.com/legal/terms-and-policies/privacy-policy"
UBUNTU_CODENAME=noble
LOGO=ubuntu-logo
Linux Ubuntu-2404-noble-amd64-base 6.8.0-78-generic #78-Ubuntu SMP PREEMPT_DYNAMIC Tue Aug 12 11:34:18 UTC 2025 x86_64 x86_64 x86_64 GNU/Linux
```

| File                                                     | SHA256                                                           |
|:---------------------------------------------------------|:-----------------------------------------------------------------|
| examples/gencode.vM25.basic.chr19.gff3.gz                | 5b6437177b7cbba4d076917819150bdeb113f54b39b1e2e33cfde5a8719243c8 |
| examples/thymus_CTCF_ENCFF714WDP.chr19.narrowPeak.gz     | 11fca62a167216eeae71acbddcc71467d8427fd393f8f7b4d438d08e3666f27d |
| examples/thymus_DNase_ENCFF979ULB.chr19.narrowPeak.gz    | 9afc1062b96cfa26dd65c32774fcc32616f66742ca44e9674b842209efebb9bc |
| examples/thymus_H3K27me3_ENCFF478UYW.chr19.narrowPeak.gz | 720ecc922fa8e6ef19bc32a36eefc2a5f144a4c107182bdd0fd191316a4fbc76 |
| examples/thymus_H3K36me3_ENCFF853BYO.chr19.narrowPeak.gz | da399745a2af18d1ada09e4f547530f60a90545d241c9c94734dc6e091f12740 |
| examples/thymus_H3K4me3_ENCFF674JZY.chr19.narrowPeak.gz  | 8b1a40a27f8690de5d64ed9865c75e4bfdeb3ceb3f864e41d36379b1251f04f9 |
