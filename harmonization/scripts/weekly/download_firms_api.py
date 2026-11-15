"""Download FIRMS active-fire detections through the Area API.

Reads FIRMS_MAP_KEY from the environment or from ./.env. The key is never printed:
every message passes through `mask()`.

Examples (run from the repo root):
    python scripts/download_firms_api.py availability
    python scripts/download_firms_api.py plan    --aois ukraine iberia --start 2025-01-01
    python scripts/download_firms_api.py fetch   --aois ukraine iberia --start 2025-01-01
    python scripts/download_firms_api.py fetch   --aois ukraine --families noaa20 --start 2018-01-01 --end 2024-12-31

Limits of the API (https://firms.modaps.eosdis.nasa.gov/api/area/): at most 5 days per request and
5000 transactions per 10 minutes; larger requests may count several times. We stay far below that.

Output: data/raw/firms_api/<SOURCE>/<aoi>/<start>_<days>d.csv  (ignored by git).
Existing non-empty files are skipped, so the script can be re-run to resume.
"""
from __future__ import annotations

import argparse
import csv
import io
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "raw" / "firms_api"
BASE = "https://firms.modaps.eosdis.nasa.gov"
MAX_DAYS = 5

# AOIs are bounding boxes (west, south, east, north). They include parts of neighbouring countries,
# so they are NOT identical to the country-polygon archives used for the yearly country archives.
AOIS = {
    "ukraine": (22.0, 44.0, 40.5, 52.5),
    "iberia": (-10.0, 35.5, 4.5, 44.0),  # Spain + Portugal mainland
    "greece": (19.0, 34.5, 29.8, 42.0),
    "italy": (6.5, 35.4, 18.8, 47.2),
}

# family -> (standard-processing source or None, near-real-time source)
FAMILIES = {
    "snpp": ("VIIRS_SNPP_SP", "VIIRS_SNPP_NRT"),
    "noaa20": ("VIIRS_NOAA20_SP", "VIIRS_NOAA20_NRT"),
    "noaa21": (None, "VIIRS_NOAA21_NRT"),
    "modis": ("MODIS_SP", "MODIS_NRT"),
}


# ---------------------------------------------------------------- key handling
def load_dotenv(path: Path = ROOT / ".env") -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip("\"'"))


def get_key() -> str:
    load_dotenv()
    key = os.environ.get("FIRMS_MAP_KEY", "")
    if not key:
        sys.exit("FIRMS_MAP_KEY is not set (put it in .env, see .env.example).")
    if len(key) < 16 or not key.isprintable() or any(c.isspace() for c in key):
        sys.exit(
            "FIRMS_MAP_KEY in .env looks invalid (too short or contains control/space characters). "
            "Re-enter it, e.g. by editing .env in an editor. The value is not shown for safety."
        )
    return key


KEY = ""


def mask(text: str) -> str:
    return text.replace(KEY, "***") if KEY else text


# ---------------------------------------------------------------- HTTP
def http_get(path: str, retries: int = 4, pause: float = 2.0) -> str:
    url = f"{BASE}{path}"
    last = ""
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=90) as r:
                return r.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")[:200]
            last = f"HTTP {e.code}: {body}"
            if e.code in (400, 401, 403, 404):  # not worth retrying
                break
        except Exception as e:  # network trouble
            last = type(e).__name__
        time.sleep(pause * (attempt + 1))
    raise RuntimeError(mask(last))


def looks_like_error(body: str) -> bool:
    head = body.lstrip()[:200].lower()
    return head.startswith("<") or "invalid" in head or "exceed" in head or "error" in head


# ---------------------------------------------------------------- availability
@dataclass
class Avail:
    source: str
    first: date
    last: date


def fetch_availability() -> dict[str, Avail]:
    body = http_get(f"/api/data_availability/csv/{KEY}/ALL")
    if looks_like_error(body):
        raise RuntimeError(mask(body[:200]))
    out: dict[str, Avail] = {}
    for row in csv.DictReader(io.StringIO(body)):
        # Column names are not documented here; accept the common variants.
        name = row.get("data_id") or row.get("source") or next(iter(row.values()))
        lo = row.get("min_date") or row.get("min_day") or row.get("start_date")
        hi = row.get("max_date") or row.get("max_day") or row.get("end_date")
        try:
            out[name] = Avail(name, date.fromisoformat(lo[:10]), date.fromisoformat(hi[:10]))
        except Exception:
            continue
    if not out:
        raise RuntimeError("could not parse data_availability response; first line: " + mask(body.splitlines()[0][:120] if body else ""))
    return out


# ---------------------------------------------------------------- planning
def chunks(start: date, end: date):
    d = start
    while d <= end:
        n = min(MAX_DAYS, (end - d).days + 1)
        yield d, n
        d += timedelta(days=n)


def segments(avail: dict[str, Avail], family: str, start: date, end: date):
    """Split [start, end] into (source, from, to) using SP where available, NRT afterwards."""
    sp, nrt = FAMILIES[family]
    segs = []
    cur = start
    if sp and sp in avail:
        a = avail[sp]
        lo, hi = max(cur, a.first), min(end, a.last)
        if lo <= hi:
            segs.append((sp, lo, hi))
            cur = hi + timedelta(days=1)
    if cur <= end and nrt in avail:
        a = avail[nrt]
        lo, hi = max(cur, a.first), min(end, a.last)
        if lo <= hi:
            segs.append((nrt, lo, hi))
    covered = sum((t - f).days + 1 for _, f, t in segs)
    missing = (end - start).days + 1 - covered
    return segs, missing


def target_path(source: str, aoi: str, d: date, n: int) -> Path:
    return OUT / source / aoi / f"{d.isoformat()}_{n}d.csv"


# ---------------------------------------------------------------- commands
def cmd_availability(_args) -> None:
    av = fetch_availability()
    print(f"{'source':22s} {'first':12s} {'last':12s}")
    for name in sorted(av):
        print(f"{name:22s} {av[name].first}  {av[name].last}")


def build_jobs(args, av):
    start, end = date.fromisoformat(args.start), date.fromisoformat(args.end)
    jobs, notes = [], []
    for fam in args.families:
        segs, missing = segments(av, fam, start, end)
        if missing:
            notes.append(f"{fam}: {missing} day(s) of the requested range are outside the available data")
        for src, f, t in segs:
            for aoi in args.aois:
                for d, n in chunks(f, t):
                    jobs.append((src, aoi, d, n))
    return jobs, notes


def cmd_plan(args) -> None:
    av = fetch_availability()
    jobs, notes = build_jobs(args, av)
    todo = [j for j in jobs if not target_path(j[0], j[1], j[2], j[3]).exists()]
    print(f"{len(jobs)} requests in total, {len(todo)} not yet downloaded")
    by = {}
    for s, a, *_ in jobs:
        by[(s, a)] = by.get((s, a), 0) + 1
    for (s, a), c in sorted(by.items()):
        print(f"  {s:18s} {a:10s} {c:5d} requests")
    for n in notes:
        print("note:", n)


def cmd_fetch(args) -> None:
    av = fetch_availability()
    jobs, notes = build_jobs(args, av)
    for n in notes:
        print("note:", n)
    today = datetime.now(timezone.utc).date()
    done = skipped = failed = 0
    t0 = time.time()
    for i, (src, aoi, d, n) in enumerate(jobs, 1):
        p = target_path(src, aoi, d, n)
        recent = (today - (d + timedelta(days=n - 1))).days < 3  # NRT data still being revised
        if p.exists() and p.stat().st_size > 0 and not (recent or args.refresh):
            skipped += 1
            continue
        w, s_, e, no = AOIS[aoi]
        try:
            body = http_get(f"/api/area/csv/{KEY}/{src}/{w},{s_},{e},{no}/{n}/{d.isoformat()}")
            if looks_like_error(body):
                raise RuntimeError(mask(body[:150]))
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(body, encoding="utf-8")
            done += 1
        except Exception as ex:
            failed += 1
            print(f"FAILED {src} {aoi} {d} ({n}d): {mask(str(ex))}")
        if (done + failed) % 25 == 0 and (done + failed):
            print(f"  {i}/{len(jobs)}  downloaded={done} skipped={skipped} failed={failed}  {time.time()-t0:.0f}s")
        time.sleep(args.pause)
    print(f"finished: downloaded={done} skipped={skipped} failed={failed}  ({time.time()-t0:.0f}s)")
    if failed:
        sys.exit(1)


def main() -> None:
    global KEY
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("availability", help="show first/last available date per FIRMS source")
    for name in ("plan", "fetch"):
        p = sub.add_parser(name)
        p.add_argument("--aois", nargs="+", default=list(AOIS), choices=list(AOIS))
        p.add_argument("--families", nargs="+", default=["snpp", "noaa20", "noaa21"], choices=list(FAMILIES))
        p.add_argument("--start", default="2025-01-01")
        p.add_argument("--end", default=datetime.now(timezone.utc).date().isoformat())
        p.add_argument("--pause", type=float, default=0.4, help="seconds between requests")
        p.add_argument("--refresh", action="store_true", help="re-download existing files")
    args = ap.parse_args()
    KEY = get_key()
    {"availability": cmd_availability, "plan": cmd_plan, "fetch": cmd_fetch}[args.cmd](args)


if __name__ == "__main__":
    main()
