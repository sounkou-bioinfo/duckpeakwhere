# Independent oracle for the thymus example, sharing no code with the SQL pipeline:
# read the GFF3 by hand, build every category interval, and for each peak centre scan
# all intervals for the best priority. Slow on purpose. Writes
# test/fixtures/thymus-expected.json. Run from the repository root: python3 test/oracle.py
import json
import gzip, bisect, collections, urllib.parse
from pathlib import Path
UP = DOWN = 1000
CAT = ["promoter","utr5","utr3","exon","intron","intergenic"]
rows = [l.rstrip("\n").split("\t") for l in gzip.open("examples/gencode.vM25.basic.chr19.gff3.gz","rt") if not l.startswith("#")]
def attrs(s): return {k: urllib.parse.unquote(v) for k,_,v in (p.partition("=") for p in s.split(";") if "=" in p)}
byid = {}; exon_parents = set(); parts = []
for c in rows:
    a = attrs(c[8]); s, e = int(c[3]) - 1, int(c[4])
    if "ID" in a: byid.setdefault(a["ID"], (c[0], s, e, c[6]))
    t = c[2].lower()
    for p in a.get("Parent","").split(","):
        if p and t in ("exon","five_prime_utr","three_prime_utr"):
            parts.append((p, t, c[0], s, e))
            if t == "exon": exon_parents.add(p)
iv = collections.defaultdict(list)  # chrom -> (s,e,prio)
for tx in exon_parents:
    chrom, s, e, strand = byid[tx]
    t = s if strand == "+" else e - 1
    ps, pe = (t-UP, t+DOWN+1) if strand == "+" else (t-DOWN, t+UP+1)
    iv[chrom].append((max(0,ps), pe, 1)); iv[chrom].append((s, e, 5))
for tx, t, chrom, s, e in parts:
    if tx in exon_parents:
        iv[chrom].append((s, e, {"five_prime_utr":2,"three_prime_utr":3,"exon":4}[t]))
def cat(chrom, x):
    best = 6
    for s, e, p in iv.get(chrom, ()):
        if s <= x < e and p < best: best = p
    return best
out = {}
for f in sorted(Path("examples").glob("*.narrowPeak.gz")):
    n = collections.Counter()
    for l in gzip.open(f, "rt"):
        c = l.split("\t"); s, e = int(c[1]), int(c[2])
        n[CAT[cat(c[0], s + (e - s)//2) - 1]] += 1
    out[f.name.split("_")[1]] = {k: n[k] for k in CAT}
Path("test/fixtures/thymus-expected.json").write_text(json.dumps(
    {"_comment": "Peak-centre counts from test/oracle.py, promoter 1000/1000, all transcripts.", "counts_centre": out},
    indent=2) + "\n")
print(json.dumps(out))
