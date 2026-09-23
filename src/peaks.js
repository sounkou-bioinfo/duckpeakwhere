// One BED-family contract for Where and Peek. DuckHTS owns parsing and contig keys.
const lit = (value) => `'${String(value).replaceAll("'", "''")}'`;

export async function readPeaks(conn, peaks) {
  if (!peaks.length) throw new Error("Choose at least one peak file.");
  await conn.query(`CREATE OR REPLACE TEMP TABLE peak (
    fid INTEGER, label VARCHAR, raw_chrom VARCHAR, ckey VARCHAR,
    s BIGINT, e BIGINT, name VARCHAR, reason VARCHAR)`);
  const files = [];
  for (const [fid, file] of peaks.entries()) {
    let error = null;
    try {
      await conn.query(`INSERT INTO peak
        SELECT ${fid}, ${lit(file.label)}, chrom, duckhts_contig_key(trim(chrom)), s, e, name,
          CASE WHEN chrom IS NULL OR trim(chrom) = '' THEN 'empty chromosome'
            WHEN s IS NULL OR e IS NULL THEN 'non-integer or missing coordinate'
            WHEN s < 0 OR e < 0 THEN 'negative coordinate'
            WHEN e < s THEN 'end before start'
            WHEN e = s THEN 'zero width'
            WHEN e > 2147483647 THEN 'coordinate exceeds the cgranges 32-bit range'
            ELSE NULL END
        FROM (SELECT chrom, start AS s, "end" AS e, name
          FROM read_bed(${lit(file.url)}, scan_mode := 'sequential'))`);
    } catch (e) {
      error = e.message;
      // A failed file contributes no rows, even if its reader emitted earlier chunks.
      await conn.query(`DELETE FROM peak WHERE fid = ${fid}`);
    }
    const rejected = (await conn.query(`SELECT reason, count(*) AS n FROM peak
      WHERE fid = ${fid} AND reason IS NOT NULL GROUP BY reason ORDER BY reason`)).toArray()
      .map((r) => ({ reason: r.reason, n: Number(r.n) }));
    files.push({ ...file, fid, error, rejected,
      rejectedCount: rejected.reduce((n, r) => n + r.n, 0) });
  }
  return files;
}

export function peakWarnings(file) {
  if (file.error) return [`${file.label}: could not read file: ${file.error}`];
  return file.rejected.map(({ reason, n }) => `${file.label}: rejected ${n} row(s): ${reason}.`);
}
