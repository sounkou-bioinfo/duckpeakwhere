// One BED-family contract for Where and Peek. DuckHTS owns parsing and contig keys.
const lit = (value) => `'${String(value).replaceAll("'", "''")}'`;

export const readPeaks = (conn, peaks) => createPeakStore(conn).sync(peaks);

export function createPeakStore(conn) {
  const cached = new Map();
  let initialized = false, nextId = 0;
  return { sync, clear };

  async function clear() {
    await conn.query("DROP TABLE IF EXISTS peak");
    cached.clear();
    initialized = false;
    nextId = 0;
  }

  async function sync(peaks) {
    if (!peaks.length) throw new Error("Choose at least one peak file.");
    if (!initialized) {
      await conn.query(`CREATE OR REPLACE TEMP TABLE peak (
        fid INTEGER, label VARCHAR, raw_chrom VARCHAR, ckey VARCHAR,
        s BIGINT, e BIGINT, name VARCHAR, summit BIGINT, reason VARCHAR)`);
      initialized = true;
    }
    const keys = peaks.map((p) => JSON.stringify([p.url, p.label, p.filename]));
    for (const [key, file] of cached) {
      if (!keys.includes(key)) {
        await conn.query(`DELETE FROM peak WHERE fid = ${file.fid}`);
        cached.delete(key);
      }
    }
    const files = [];
    for (const [i, file] of peaks.entries()) {
      const key = keys[i];
      if (!cached.has(key)) cached.set(key, await read(file, nextId++));
      files.push(cached.get(key));
    }
    return files;
  }

  async function read(file, fid) {
    let error = null;
    try {
      await conn.query(`INSERT INTO peak
        SELECT ${fid}, ${lit(file.label)}, chrom, duckhts_contig_key(trim(chrom)), s, e, name, summit,
          CASE WHEN chrom IS NULL OR trim(chrom) = '' THEN 'empty chromosome'
            WHEN s IS NULL OR e IS NULL THEN 'non-integer or missing coordinate'
            WHEN s < 0 OR e < 0 THEN 'negative coordinate'
            WHEN e < s THEN 'end before start'
            WHEN e = s THEN 'zero width'
            WHEN e > 2147483647 THEN 'coordinate exceeds the cgranges 32-bit range'
            ELSE NULL END
        FROM (SELECT chrom, start AS s, "end" AS e, name, block_count AS summit
          FROM read_bed(${lit(file.url)}, scan_mode := 'sequential'))`);
    } catch (e) {
      error = e.message;
      // A failed file contributes no rows, even if its reader emitted earlier chunks.
      await conn.query(`DELETE FROM peak WHERE fid = ${fid}`);
    }
    const rejected = (await conn.query(`SELECT reason, count(*) AS n FROM peak
      WHERE fid = ${fid} AND reason IS NOT NULL GROUP BY reason ORDER BY reason`)).toArray()
      .map((r) => ({ reason: r.reason, n: Number(r.n) }));
    // read_bed calls column 10 block_count; only narrowPeak defines it as a summit.
    const narrowPeak = /\.narrowPeak(?:\.(?:gz|bgz))?(?:[?#].*)?$/i.test(file.filename ?? file.url);
    return { ...file, fid, narrowPeak, error, rejected,
      rejectedCount: rejected.reduce((n, r) => n + r.n, 0) };
  }
}

export function peakWarnings(file) {
  if (file.error) return [`${file.label}: could not read file: ${file.error}`];
  return file.rejected.map(({ reason, n }) => `${file.label}: rejected ${n} row(s): ${reason}.`);
}
