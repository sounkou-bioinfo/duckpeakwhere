// PeakPeek's BED-family statistics: DuckHTS readers/overlap kernels, SQL reductions.
// Compatibility: README.Rmd, PeakPeek SPEC §4 and ADRs 0001/0003/0004/0006/0007/0011.
const lit = (value) => `'${String(value).replaceAll("'", "''")}'`;
const rows = async (conn, sql) => (await conn.query(sql)).toArray().map((row) =>
  Object.fromEntries(Object.entries(row.toJSON()).map(([key, value]) => [key, typeof value === "bigint" ? Number(value) : value])));

/** No annotation needed. The caller owns input URLs until this promise settles. */
export async function peek(conn, { peaks }) {
  if (!peaks.length) throw new Error("Choose at least one peak file.");
  const errors = new Map();
  let indexed = false;
  try {
    await conn.query(`CREATE OR REPLACE TEMP TABLE peek_raw (
      fid INTEGER, chrom VARCHAR, s BIGINT, e BIGINT, name VARCHAR)`);
    for (const [fid, file] of peaks.entries()) {
      try {
        await conn.query(`INSERT INTO peek_raw SELECT ${fid}, trim(chrom), start, "end", name
          FROM read_bed(${lit(file.url)}, scan_mode := 'sequential')`);
      } catch (error) {
        errors.set(fid, error.message);
      }
    }
    await conn.query(`CREATE OR REPLACE TEMP TABLE peek_checked AS
      SELECT *, CASE
        WHEN chrom IS NULL OR chrom = '' THEN 'empty chromosome'
        WHEN s IS NULL OR e IS NULL THEN 'non-integer or missing coordinate'
        WHEN s < 0 OR e < 0 THEN 'negative coordinate'
        WHEN e < s THEN 'end before start'
        WHEN e = s THEN 'zero width'
        WHEN e > 2147483647 THEN 'coordinate exceeds the cgranges 32-bit range'
        ELSE NULL END AS reason FROM peek_raw`);
    await conn.query(`CREATE OR REPLACE TEMP TABLE peek_valid AS
      SELECT *, row_number() OVER ()::INTEGER AS rid, e - s AS w,
        fid::VARCHAR || ':' || chrom AS seq,
        regexp_full_match(chrom, '(chr)?([0-9]+|X|Y|M|MT)', 'i') AS main,
        duckhts_contig_key(chrom) AS ckey
      FROM peek_checked WHERE reason IS NULL`);
    await conn.query(`SELECT duckhts_cgranges_create('peek')`);
    indexed = true;
    await conn.query(`SELECT bool_and(duckhts_cgranges_add('peek', seq, s, e, rid)) FROM peek_valid`);
    await conn.query(`SELECT duckhts_cgranges_index('peek')`);

    // Disjoint endpoint spans; membership is decided by cgranges, not an overlap engine in JS/SQL.
    await conn.query(`CREATE OR REPLACE TEMP TABLE peek_span AS
      WITH endpoints AS (SELECT fid, seq, s AS p FROM peek_valid UNION SELECT fid, seq, e FROM peek_valid)
      SELECT fid, seq, p AS s, lead(p) OVER (PARTITION BY seq ORDER BY p) AS e FROM endpoints`);
    const summaries = await rows(conn, `WITH coverage AS (
        SELECT fid, sum(e - s)::BIGINT AS mergedBp FROM peek_span WHERE e > s
          AND duckhts_cgranges_has_overlap('peek', seq, s, e) GROUP BY fid
      ), duplicates AS (
        SELECT fid, sum(n - 1)::BIGINT AS duplicates FROM
          (SELECT fid, chrom, s, e, count(*) AS n FROM peek_valid GROUP BY ALL) GROUP BY fid
      )
      SELECT v.fid, count(*) AS n, min(w) AS min, median(w) AS median, avg(w) AS mean,
        max(w) AS max, sum(w)::BIGINT AS sum, any_value(c.mergedBp) AS mergedBp,
        any_value(d.duplicates) AS duplicates, count(DISTINCT chrom) AS chromosomes,
        count(*) FILTER (WHERE NOT main) AS offMain,
        count(*) FILTER (WHERE w > 100000) AS over100kb,
        count(*) FILTER (WHERE starts_with(lower(chrom), 'chr')) AS withChr,
        count(*) FILTER (WHERE duckhts_cgranges_count_overlaps('peek', seq, s, e) > 1) AS overlapping
      FROM peek_valid v JOIN coverage c USING(fid) JOIN duplicates d USING(fid) GROUP BY v.fid ORDER BY v.fid`);
    const rejected = await rows(conn, `SELECT fid, reason, count(*) AS n,
        sum(count(*)) OVER (PARTITION BY fid)::BIGINT AS total FROM peek_checked
      WHERE reason IS NOT NULL GROUP BY fid, reason ORDER BY fid, reason`);
    const perChrom = await rows(conn, `SELECT * FROM (
      SELECT fid, CASE WHEN main THEN chrom ELSE 'other' END AS chrom,
        CASE WHEN main THEN ckey ELSE 'other' END AS key, count(*) AS n
      FROM peek_valid GROUP BY 1, 2, 3)
      ORDER BY fid, CASE WHEN try_cast(key AS DOUBLE) IS NOT NULL THEN 0 WHEN key = 'X' THEN 1
        WHEN key = 'Y' THEN 2 WHEN key = 'MT' THEN 3 ELSE 4 END, try_cast(key AS DOUBLE), chrom`);
    const aligned = await rows(conn, `SELECT * FROM (
      SELECT fid, CASE WHEN main THEN ckey ELSE 'other' END AS chrom, count(*) AS n
      FROM peek_valid GROUP BY 1, 2)
      ORDER BY CASE WHEN try_cast(chrom AS DOUBLE) IS NOT NULL THEN 0 WHEN chrom = 'X' THEN 1
        WHEN chrom = 'Y' THEN 2 WHEN chrom = 'MT' THEN 3 ELSE 4 END, try_cast(chrom AS DOUBLE), chrom, fid`);

    // ADR-0006: shared 30 log-spaced bins, [from,to), with the maximum in the last bin.
    await conn.query(`CREATE OR REPLACE TEMP TABLE peek_bins AS
      WITH bounds AS (SELECT min(w)::DOUBLE AS lo, greatest(max(w), min(w) + 1)::DOUBLE AS hi FROM peek_valid)
      SELECT i AS bin,
        CASE WHEN i = 0 THEN lo ELSE exp(ln(lo) + i * ((ln(hi) - ln(lo)) / 30)) END AS "from",
        CASE WHEN i = 29 THEN hi ELSE exp(ln(lo) + (i + 1) * ((ln(hi) - ln(lo)) / 30)) END AS "to"
      FROM bounds, range(30) t(i) WHERE lo IS NOT NULL`);
    const histogram = await rows(conn, `SELECT f.fid, b.bin, b."from", b."to", count(v.rid) AS n
      FROM range(${peaks.length}) f(fid) CROSS JOIN peek_bins b
      LEFT JOIN peek_valid v ON v.fid = f.fid AND v.w >= b."from"
        AND (v.w < b."to" OR (b.bin = 29 AND v.w <= b."to"))
      GROUP BY ALL ORDER BY f.fid, b.bin`);
    const extremes = await rows(conn, `WITH ranked AS (
        SELECT *, row_number() OVER (PARTITION BY fid ORDER BY w, rid) AS smallest,
          row_number() OVER (PARTITION BY fid ORDER BY w DESC, rid) AS largest FROM peek_valid)
      SELECT fid, chrom, s, e, name, w, 'smallest' AS kind, smallest AS rank FROM ranked WHERE smallest <= 5
      UNION ALL SELECT fid, chrom, s, e, name, w, 'largest', largest FROM ranked WHERE largest <= 5
      ORDER BY fid, kind, rank`);

    const results = peaks.map((file, fid) => {
      const stats = summaries.find((s) => s.fid === fid) ?? {
        n: 0, min: null, median: null, mean: null, max: null, sum: 0, mergedBp: 0,
        duplicates: 0, chromosomes: 0, offMain: 0, over100kb: 0, withChr: 0, overlapping: 0,
      };
      return { ...stats, fid, label: file.label, error: errors.get(fid) ?? null,
        rejectedCount: rejected.find((r) => r.fid === fid)?.total ?? 0,
        chromStyle: stats.n === 0 ? null : stats.withChr === stats.n ? "chr" : stats.withChr === 0 ? "bare" : "mixed",
        rejected: rejected.filter((r) => r.fid === fid), perChrom: perChrom.filter((r) => r.fid === fid),
        histogram: histogram.filter((r) => r.fid === fid), extremes: extremes.filter((r) => r.fid === fid) };
    });
    return { results, aligned };
  } finally {
    if (indexed) await conn.query(`SELECT duckhts_cgranges_destroy('peek')`);
    for (const table of ["peek_raw", "peek_checked", "peek_valid", "peek_span", "peek_bins"]) {
      await conn.query(`DROP TABLE IF EXISTS ${table}`);
    }
  }
}
