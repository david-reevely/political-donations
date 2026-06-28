#!/usr/bin/env python3
"""
build_site.py — Turn the Elections Canada contributions CSV into a static,
client-searchable site: an index of gzipped JSON shards bucketed by contributor
surname, plus a manifest. Served as-is from GitHub Pages; the browser fetches
only the one shard a queried surname hashes to.

Usage:
    python3 build_site.py <csv_path> <out_dir> [nbuckets]

Produces:
    <out_dir>/manifest.json
    <out_dir>/shards/s0.json.gz ... s{N-1}.json.gz

Pass 1 streams the CSV into one temp file keyed by bucket; we sort it by bucket
with the system `sort` (disk-backed, low memory); pass 2 groups by bucket and
writes one gzipped shard each. Memory stays bounded to a single bucket.
"""

import csv
import gzip
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import unicodedata
from datetime import datetime, timezone

csv.field_size_limit(1 << 24)

# ---- source column positions (validated against the header) ----------------
I_ENTITY, I_RECIPIENT, I_PARTY, I_DISTRICT, I_EVENT = 0, 2, 6, 7, 8
I_FISCAL, I_CTYPE, I_CNAME, I_CLAST = 9, 14, 15, 16
I_CITY, I_PROV, I_POSTAL, I_RECVD = 19, 20, 21, 22
I_MONETARY, I_NONMON, I_GIVEN, I_LEADER = 23, 24, 25, 26

# ---- normalization (must match search.js byte-for-byte) --------------------
_combining = unicodedata.combining
_apostrophe = re.compile(r"['\u2019\u2018\u0060\u00b4]")
_nonword = re.compile(r"[^a-z0-9 ]+")
_spaces = re.compile(r"\s+")


def normalize(s: str) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not _combining(c))
    s = s.lower()
    s = _apostrophe.sub("", s)
    s = _nonword.sub(" ", s)
    return _spaces.sub(" ", s).strip()


def fnv1a32(s: str) -> int:
    """32-bit FNV-1a over the ASCII bytes of a normalized token.
    Mirrored exactly in search.js so Python and the browser agree on buckets."""
    h = 2166136261
    for ch in s.encode("utf-8"):
        h ^= ch
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def parse_cents(s: str) -> int:
    if not s:
        return 0
    s = s.strip().replace(",", "")
    if not s:
        return 0
    try:
        return int(round(float(s) * 100))
    except ValueError:
        return 0


def clean(s: str) -> str:
    """Strip and remove tab/newline so the field survives the tab-delimited
    temp file used between passes."""
    return s.strip().replace("\t", " ").replace("\r", " ").replace("\n", " ")


def build(csv_path, out_dir, nbuckets):
    shards_dir = os.path.join(out_dir, "shards")
    os.makedirs(shards_dir, exist_ok=True)
    start = time.time()

    tmp = tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", suffix=".tsv", delete=False, newline="")
    tmp_path = tmp.name
    rid = 0
    placements = 0

    # ---- pass 1: stream CSV -> "bucket \t fields" lines --------------------
    with open(csv_path, "r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.reader(fh)
        next(reader, None)  # header (BOM already stripped by utf-8-sig)
        for row in reader:
            if len(row) < 25:
                continue
            rid += 1
            recvd = clean(row[I_RECVD])
            fiscal = clean(row[I_FISCAL])
            sort_date = recvd or fiscal

            surname_tokens = set(normalize(row[I_CLAST]).split())
            if not surname_tokens:
                # Fall back to the full contributor-name field if last name is
                # blank (rare), so the row is still findable.
                surname_tokens = set(normalize(row[I_CNAME]).split())
            if not surname_tokens:
                continue

            fields = "\t".join((
                str(rid), sort_date, clean(row[I_RECIPIENT]), clean(row[I_PARTY]),
                clean(row[I_DISTRICT]), clean(row[I_ENTITY]), clean(row[I_CTYPE]),
                clean(row[I_CNAME]), clean(row[I_CITY]), clean(row[I_PROV]),
                clean(row[I_POSTAL]), str(parse_cents(row[I_MONETARY])),
                str(parse_cents(row[I_NONMON])), clean(row[I_EVENT]),
                clean(row[I_GIVEN]) if len(row) > I_GIVEN else "",
                clean(row[I_LEADER]) if len(row) > I_LEADER else "",
            ))

            buckets = {fnv1a32(t) % nbuckets for t in surname_tokens}
            for b in buckets:
                tmp.write(f"{b}\t{fields}\n")
                placements += 1
            if rid % 1_000_000 == 0:
                print(f"  pass1 {rid:,} rows", file=sys.stderr, flush=True)
    tmp.close()
    print(f"pass1 done: {rid:,} rows, {placements:,} placements "
          f"({time.time()-start:.0f}s)", file=sys.stderr)

    # ---- sort by bucket (numeric, disk-backed) -----------------------------
    sorted_path = tmp_path + ".sorted"
    env = dict(os.environ, LC_ALL="C")
    subprocess.run(["sort", "-t", "\t", "-k1,1n", "-o", sorted_path, tmp_path],
                   check=True, env=env)
    os.remove(tmp_path)
    print(f"sort done ({time.time()-start:.0f}s)", file=sys.stderr)

    # ---- pass 2: group by bucket -> gzipped shard --------------------------
    written = [False] * nbuckets

    def flush(bucket, lines):
        dicts = {"r": {}, "p": {}, "t": {}, "e": {}, "c": {}, "v": {}}
        order = {"r": [], "p": [], "t": [], "e": [], "c": [], "v": []}

        def code(key, val):
            d = dicts[key]
            if val not in d:
                d[val] = len(order[key])
                order[key].append(val)
            return d[val]

        rows = []
        for ln in lines:
            f = ln.split("\t")
            # f[0] is bucket; row fields follow
            rows.append([
                int(f[1]),                 # id
                f[2],                      # date
                code("r", f[3]),           # recipient
                code("p", f[4]),           # party
                code("t", f[5]),           # district
                code("e", f[6]),           # entity
                code("c", f[7]),           # ctype
                f[8],                      # name
                f[9],                      # city
                f[10],                     # prov
                f[11],                     # postal
                int(f[12]),                # monetary cents
                int(f[13]),                # non-monetary cents
                code("v", f[14]),          # event
                f[15],                     # given_through
                f[16].rstrip("\n"),        # leadership contestant
            ])
        payload = {"d": {k: order[k] for k in order}, "rows": rows}
        data = json.dumps(payload, ensure_ascii=False,
                          separators=(",", ":")).encode("utf-8")
        with gzip.open(os.path.join(shards_dir, f"s{bucket}.json.gz"),
                       "wb", compresslevel=6) as gz:
            gz.write(data)
        written[bucket] = True

    cur_bucket = None
    buf = []
    with open(sorted_path, "r", encoding="utf-8", newline="") as fh:
        for line in fh:
            b = int(line[:line.index("\t")])
            if b != cur_bucket:
                if cur_bucket is not None:
                    flush(cur_bucket, buf)
                cur_bucket = b
                buf = []
            buf.append(line)
        if cur_bucket is not None:
            flush(cur_bucket, buf)
    os.remove(sorted_path)

    # Empty buckets get an empty shard so the client never 404s.
    empty = json.dumps({"d": {k: [] for k in "rptecv"}, "rows": []},
                       separators=(",", ":")).encode("utf-8")
    for b in range(nbuckets):
        if not written[b]:
            with gzip.open(os.path.join(shards_dir, f"s{b}.json.gz"), "wb") as gz:
                gz.write(empty)

    manifest = {
        "version": 1,
        "hash": "fnv1a32",
        "nbuckets": nbuckets,
        "rows": rid,
        "built": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Elections Canada — contributions as filed",
    }
    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    total_gz = sum(
        os.path.getsize(os.path.join(shards_dir, fn))
        for fn in os.listdir(shards_dir))
    print(f"done: {nbuckets} shards, {total_gz/1e6:.0f} MB total, "
          f"{rid:,} rows ({time.time()-start:.0f}s)", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit("usage: build_site.py <csv_path> <out_dir> [nbuckets]")
    nb = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
    build(sys.argv[1], sys.argv[2], nb)
