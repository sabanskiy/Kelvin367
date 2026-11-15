"""Streaming build of a coarse regional grid from the FIRMS yearly country archives.

For every country of a region and every file (MODIS 2003-2024, VIIRS S-NPP 2012-2024) the file is downloaded to a temporary directory,
filtered with the profile `conf_persistent` (confidence + persistent-pixel rule), counted into 0.5 degree cells by week, platform and
day/night, the partial result is cached (data/interim/grid_parts/<region>/*.npz) and the raw file is deleted at once. The disk is never
filled: before each download the free space must exceed the reserve (default 4 GB) plus twice the file size. Re-running resumes from the
cached parts. Output app/data/grid_<region>.{meta.json,bin.gz} and an entry in app/data/grids.json.

    python scripts/build_grid_world.py africa --plan          # sizes only (HEAD requests), nothing downloaded
    python scripts/build_grid_world.py africa                # download, aggregate, write
    python scripts/build_grid_world.py africa --reserve-gb 6 --workers 3
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts" / "weekly"))
import build_grid_data as bg  # noqa: E402
from kelvin367_harmonization.weekly import config, firms  # noqa: E402

BASE = "https://firms.modaps.eosdis.nasa.gov/data/country"
SENSORS = {"modis": range(2003, 2025), "viirs-snpp": range(2012, 2025)}
PARTS = ROOT / "data" / "interim" / "grid_parts"
TMP = ROOT / "data" / "interim" / "grid_tmp"
NE_FILE = ROOT / "data" / "raw" / "naturalearth" / "ne_10m_admin_0_countries.geojson"
SERIES = ["Terra_D", "Terra_N", "Aqua_D", "Aqua_N", "SNPP_D", "SNPP_N"]
# Natural Earth name -> FIRMS file name where they differ (found by probing the archive; other names only change spaces to underscores)
NAME_MAP = {"Dem. Rep. Congo": "Democratic_Republic_of_the_Congo", "Central African Rep.": "Central_African_Republic", "Congo": "Republic_of_Congo",
            "S. Sudan": "South_Sudan", "Côte d'Ivoire": "Cote_d_Ivoire", "Gambia": "The_Gambia", "Eq. Guinea": "Equatorial_Guinea",
            "eSwatini": "Swaziland", "Cabo Verde": "Cape_Verde", "São Tomé and Principe": "Sao_Tome_and_Principe",
            "Falkland Is.": "Falkland_Islands", "Czechia": "Czech_Republic", "Bosnia and Herz.": "Bosnia_and_Herzegovina", "Dominican Rep.": "Dominican_Republic"}
REGIONS = {
    "south_america": {"continent": "South America", "skip": ["Brazilian I.", "Southern Patagonian Ice Field"],
                      "extra": [("French Guiana", "French_Guiana")],   # part of France in Natural Earth, a file of its own in FIRMS
                      "title": "South America (pilot) 2003-2024: MODIS and S-NPP only"},
    "africa": {"continent": "Africa", "skip": ["Bir Tawil", "Somaliland", "W. Sahara"],
               "title": "Africa (pilot) 2003-2024: MODIS and S-NPP only"},
}


def countries(region: str) -> list[tuple[str, str]]:
    cfg = REGIONS[region]
    feats = json.loads(NE_FILE.read_text(encoding="utf-8"))["features"]
    names = sorted(f["properties"]["NAME"] for f in feats if f["properties"].get("CONTINENT") == cfg["continent"])
    return [(n, NAME_MAP.get(n, n.replace(" ", "_"))) for n in names if n not in cfg["skip"]] + list(cfg.get("extra", []))


def url_of(sensor: str, year: int, fname: str) -> str:
    return f"{BASE}/{sensor}/{year}/{sensor}_{year}_{fname}.csv"


def head(url: str) -> int:
    try:
        return int(urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=30).headers.get("content-length", 0))
    except urllib.error.HTTPError:
        return -1


def free_gb() -> float:
    return shutil.disk_usage(ROOT).free / 1e9


def process(job, weeks, reserve_gb: float):
    region, ne_name, fname, sensor, year, size = job
    part = PARTS / region / f"{sensor}_{year}_{fname}.npz"
    if part.exists():
        return job, "cached", 0
    if free_gb() < reserve_gb + 2 * size / 1e9:
        return job, "no-space", 0
    TMP.mkdir(parents=True, exist_ok=True)
    tmp = TMP / f"{sensor}_{year}_{fname}.csv"
    try:
        with urllib.request.urlopen(url_of(sensor, year, fname), timeout=300) as r, open(tmp, "wb") as f:
            expect = int(r.headers.get("content-length", 0))
            n = 0
            while chunk := r.read(1 << 20):
                f.write(chunk); n += len(chunk)
        if expect and n != expect:
            return job, f"incomplete {n}/{expect}", 0
        df = firms.load_file(tmp)
        n_raw = len(df)
        cells = {}
        if n_raw:
            df = firms.apply_profile(df, config.DEFAULT_PROFILE)
            cells = bg.build(df[["time_utc", "lat", "lon", "platform", "daynight"]], weeks, SERIES)
        keys = np.array(sorted(cells), dtype=np.int64)
        arr = np.stack([cells[k] for k in keys]) if len(keys) else np.zeros((0, len(SERIES), len(weeks)), dtype=np.int32)
        part.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(part, keys=keys, arr=arr.astype(np.int32), n_raw=n_raw, n_kept=int(arr.sum()))
        return job, "ok", n
    finally:
        tmp.unlink(missing_ok=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("region", choices=sorted(REGIONS))
    ap.add_argument("--plan", action="store_true", help="HEAD requests only: file counts and sizes")
    ap.add_argument("--reserve-gb", type=float, default=4.0, help="free disk space that must always remain (default 4 GB)")
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args()
    region = a.region
    weeks = pd.date_range("2003-01-06", "2024-12-23", freq="7D")
    cs = countries(region)
    jobs, missing = [], {}
    print(f"{region}: {len(cs)} countries; probing sizes", flush=True)
    probes = [(ne, f, s, y) for ne, f in cs for s, ys in SENSORS.items() for y in ys]
    with cf.ThreadPoolExecutor(16) as ex:
        sizes = list(ex.map(lambda p: head(url_of(p[2], p[3], p[1])), probes))
    for (ne, f, s, y), sz in zip(probes, sizes):
        if sz < 0:
            missing.setdefault(ne, []).append(f"{s}_{y}")
        else:
            jobs.append((region, ne, f, s, y, sz))
    tot = sum(j[5] for j in jobs)
    gone = sorted(n for n, v in missing.items() if len(v) == len([p for p in probes if p[0] == n]))
    print(f"files {len(jobs)}, {tot / 1e9:.2f} GB; countries without any archive file: {gone}; free disk {free_gb():.1f} GB", flush=True)
    if a.plan:
        return 0
    done = 0
    with cf.ThreadPoolExecutor(a.workers) as ex:
        futs = [ex.submit(process, j, weeks, a.reserve_gb) for j in jobs]
        for fu in cf.as_completed(futs):
            job, status, n = fu.result()
            done += 1
            if status not in ("ok", "cached"):
                print("  ", job[2], job[3], job[4], status, flush=True)
            if done % 100 == 0:
                print(f"  {done}/{len(jobs)} files, free disk {free_gb():.1f} GB", flush=True)
    parts = sorted((PARTS / region).glob("*.npz"))
    if len(parts) < len(jobs):
        print(f"{len(jobs) - len(parts)} files missing (no space or errors): re-run to resume", file=sys.stderr)
        return 1
    merged, raw_total, kept_total = {}, 0, 0
    for p in parts:
        z = np.load(p)
        raw_total += int(z["n_raw"]); kept_total += int(z["n_kept"])
        for k, arr in zip(z["keys"], z["arr"]):
            merged[int(k)] = merged[int(k)] + arr if int(k) in merged else arr.copy()
    cells, arr, total, clamped = bg.to_arrays(merged, len(SERIES), len(weeks))
    used = sorted({j[1] for j in jobs})
    meta = bg.common_meta(
        f"grid_{region}", REGIONS[region]["title"], weeks, SERIES, cells, total, clamped,
        valid_platforms=["MODIS", "SNPP"],
        links=[s for s in config.link_specs() if s["target"] == "MODIS"],
        baseline_years=list(config.BASELINE_YEARS), drift={"ref": list(config.DRIFT_REF_YEARS), "last": 2024}, naive_cutoff=config.NAIVE_CUTOFF,
        geometry_note=(f"FIRMS yearly country archives of {len(used)} countries of {REGIONS[region]['continent']} on cells of 0.5 degrees "
                       f"(not available in the archive: {', '.join(REGIONS[region]['skip'])}); cells with fewer than 10 detections are omitted; border cells are partial. "
                       "Coarse estimate: the coefficients come from the selected cells themselves and are unreliable for small areas."),
        filter_note=("MODIS 2003-2024 and S-NPP 2012-2024 only (no NOAA-20/21 and no 2025-2026 in this grid); confidence filter and persistent-pixel rule, no `type` filter"),
        filter_profile=firms.profile_info(config.DEFAULT_PROFILE),
        build={"files": len(parts), "raw_rows": raw_total, "kept_rows": kept_total, "countries": used,
               "missing_files": {k: v for k, v in missing.items() if k in used}})
    bg.write(f"grid_{region}", meta, arr)
    reg = json.loads((bg.OUT / "grids.json").read_text(encoding="utf-8"))["grids"] if (bg.OUT / "grids.json").exists() else []
    entry = {"id": f"grid_{region}", "from": meta["weeks"][0], "to": meta["weeks"][-1], "platforms": meta["valid_platforms"], "cells": len(cells)}
    bg.write_registry([e for e in reg if e["id"] != entry["id"]] + [entry])
    print(f"kept {kept_total:,} of {raw_total:,} rows ({100 * kept_total / max(raw_total, 1):.1f}%)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
