"""Download FIRMS yearly country archives (no key needed): MODIS 2003-2024 and VIIRS S-NPP 2012-2024.

Source: https://firms.modaps.eosdis.nasa.gov/data/country/  (modis/<year>/modis_<year>_<Country>.csv, viirs-snpp/<year>/viirs-snpp_<year>_<Country>.csv)
Output: data/raw/firms/<sensor>_<year>_<Country>.csv (git-ignored). Existing non-empty files are skipped; the size of every download is checked
against the Content-Length header.

    python scripts/download_firms_countries.py Chile Canada Indonesia South_Africa
    python scripts/download_firms_countries.py --plan Chile       # sizes only (HEAD requests)
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "raw" / "firms"
BASE = "https://firms.modaps.eosdis.nasa.gov/data/country"
SENSORS = {"modis": range(2003, 2025), "viirs-snpp": range(2012, 2025)}


def jobs(countries):
    for c in countries:
        for sensor, years in SENSORS.items():
            for y in years:
                yield c, sensor, y, f"{BASE}/{sensor}/{y}/{sensor}_{y}_{c}.csv", OUT / f"{sensor}_{y}_{c}.csv"


def head(url):
    try:
        return int(urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=30).headers.get("content-length", 0))
    except urllib.error.HTTPError as e:
        return -e.code


def fetch(job):
    c, sensor, y, url, dest = job
    if dest.exists() and dest.stat().st_size > 0:
        return job, "skipped", dest.stat().st_size
    try:
        with urllib.request.urlopen(url, timeout=120) as r:
            data = r.read()
            expect = int(r.headers.get("content-length", len(data)))
    except urllib.error.HTTPError as e:
        return job, f"http {e.code}", 0
    if len(data) != expect:
        return job, f"size mismatch {len(data)} != {expect}", len(data)
    dest.write_bytes(data)
    return job, "ok", len(data)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("countries", nargs="+")
    ap.add_argument("--plan", action="store_true", help="only report sizes")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    js = list(jobs(a.countries))
    if a.plan:
        with cf.ThreadPoolExecutor(8) as ex:
            sizes = list(ex.map(lambda j: head(j[3]), js))
        tot = {}
        for (c, s, y, u, d), sz in zip(js, sizes):
            tot[c] = tot.get(c, 0) + max(sz, 0)
            if sz < 0:
                print(f"missing {c} {s} {y} (http {-sz})")
        for c, t in tot.items():
            print(f"{c}: {t/1e6:.0f} MB")
        return
    done = fail = 0
    total = 0
    with cf.ThreadPoolExecutor(4) as ex:
        for job, status, size in ex.map(fetch, js):
            total += size
            if status in ("ok", "skipped"):
                done += 1
            else:
                fail += 1
                print(f"FAILED {job[0]} {job[1]} {job[2]}: {status}")
    print(f"finished: ok={done} failed={fail} total={total/1e6:.0f} MB")
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
