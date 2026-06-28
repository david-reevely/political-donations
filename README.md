# Political donations search

A static, client-side search over Elections Canada's "Contribution to all
political entities, as filed" dataset. Enter a contributor's surname and get
their donations grouped by recipient or laid out chronologically (colour-coded
by party).

## How it works

There is no server. `build_site.py` streams the Elections Canada CSV and writes
~1,024 gzipped JSON shards bucketed by a hash of the contributor's surname, plus
a `manifest.json`. The page (`site/index.html` + `search.js` + `render.js`)
computes the same hash in the browser, fetches only the shard a queried surname
falls in, decompresses it, filters, and renders. Everything is served as static
files from GitHub Pages.

The weekly GitHub Actions workflow downloads the latest file, rebuilds the
shards, and deploys the site. The shards are built fresh each run and published
as the Pages artifact, so they never bloat this repo.

## Build and preview locally

```bash
python3 build_site.py /path/to/od_cntrbtn_de_e.csv site 1024
cd site && python3 -m http.server 8090   # open http://localhost:8090
```

## Notes

- Search is surname-first; add a first name or city to narrow. Matching is
  accent- and case-insensitive.
- Contributor names are **not** unique identifiers. Check city / postal code
  before relying on a match; the page flags when several name/city combinations
  match.
- Data source: Elections Canada open data (already public).
