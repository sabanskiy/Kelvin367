"""Build the gridded weekly counts for the 'draw your own area' mode of the app (app/data/grid_*.{meta.json,bin.gz}) and app/data/grids.json.

grid_europe: ONE continuous record 2003 -> 2026 for the five preset countries (Ukraine, Spain, Portugal, Greece, Italy) on 0.5 degree
cells, built from exactly the same inputs as the continuous presets: Natural Earth country masks (intersected with the API rectangle),
yearly archives up to 2024 (Terra, Aqua, S-NPP) and the FIRMS API from 2025 (NOAA-20 and NOAA-21 from the API throughout), profile
`conf_persistent`. Per cell, week, platform and day/night the detections are counted; series Terra_D ... NOAA21_N.
Binary layout: Uint16 little-endian, shape [series][cell][week], gzip-compressed. Counts above 65535 are clamped (reported).
The meta file holds weeks, series names, cells ([iy, ix] with iy = floor(lat * 2), ix = floor(lon * 2)), per-cell totals, platform
operating periods, known gaps and the training windows of the calibration links used in the browser.

Run from the repo root:  python scripts/build_grid_data.py
Other grids reuse `build`, `write` and `common_meta` from this module.
"""
from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
from kelvin367_harmonization.weekly import config, firms, policy, sensors  # noqa: E402

OUT = ROOT / "output" / "calendar"
DEG = 0.5
SERIES_ALL = ["Terra_D", "Terra_N", "Aqua_D", "Aqua_N", "SNPP_D", "SNPP_N", "NOAA20_D", "NOAA20_N", "NOAA21_D", "NOAA21_N"]
MIN_CELL_DETECTIONS = 10


def platform_info():
    return [{"name": p.name, "family": p.family, "start": p.start.isoformat(), "end": p.end.isoformat() if p.end else None,
             "planned_end": p.planned_end, "local_time": p.nominal_local_time} for p in sensors.PLATFORMS.values()]


def build(df: pd.DataFrame, weeks: pd.DatetimeIndex, series_names: list[str]):
    """df: detections with time_utc, lat, lon, platform, daynight. Returns {cell_key: int32 array [S, W]}."""
    t = df["time_utc"]
    naive = t.dt.tz_localize(None) if t.dt.tz is not None else t
    wi = pd.Series(np.arange(len(weeks)), index=weeks).reindex(naive.dt.to_period("W-SUN").dt.start_time.values).to_numpy()
    key = (df["platform"].astype(str) + "_" + df["daynight"].astype(str)).map({n: i for i, n in enumerate(series_names)})
    ok = ~np.isnan(wi) & key.notna().to_numpy()
    if not ok.any():
        return {}
    iy = np.floor(df["lat"].to_numpy()[ok] / DEG).astype(np.int64)
    ix = np.floor(df["lon"].to_numpy()[ok] / DEG).astype(np.int64)
    ck = iy * 100000 + (ix + 20000)
    uniq, inv = np.unique(ck, return_inverse=True)
    arr = np.zeros((len(series_names), len(uniq), len(weeks)), dtype=np.int32)
    np.add.at(arr, (key.to_numpy()[ok].astype(int), inv, wi[ok].astype(int)), 1)
    return {int(k): arr[:, j, :] for j, k in enumerate(uniq)}


def merge(parts: list[dict]) -> dict:
    out: dict = {}
    for p in parts:
        for k, a in p.items():
            out[k] = out[k] + a if k in out else a.copy()
    return out


def to_arrays(cellmap: dict, n_series: int, n_weeks: int):
    """Sorted cells, uint16 array [S, C, W] (clamped), per-cell totals; cells with fewer than MIN_CELL_DETECTIONS are dropped."""
    keys = sorted(k for k, a in cellmap.items() if a.sum() >= MIN_CELL_DETECTIONS)
    arr = np.zeros((n_series, len(keys), n_weeks), dtype=np.int64)
    for j, k in enumerate(keys):
        arr[:, j, :] = cellmap[k]
    clamped = int((arr > 65535).sum())
    cells = [[int(k // 100000), int(k % 100000 - 20000)] for k in keys]
    return cells, np.minimum(arr, 65535).astype(np.uint16), arr.sum(axis=(0, 2)).astype(int), clamped


def common_meta(gid, name, weeks, series, cells, total, clamped, **extra):
    meta = {"id": gid, "name": name, "deg": DEG, "weeks": [w.date().isoformat() for w in weeks], "series": series, "cells": cells,
            "total": [int(x) for x in total], "clamped": clamped, "platforms": platform_info(),
            "known_gaps": [{"platform": g.platform, "start": g.start.isoformat(), "end": g.end.isoformat()} for g in sensors.KNOWN_GAPS]}
    meta.update(extra)
    return meta


def write(name, meta, arr):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{name}.meta.json").write_text(json.dumps(meta, separators=(",", ":")), encoding="utf-8")
    raw = np.ascontiguousarray(arr).astype("<u2").tobytes()
    with open(OUT / f"{name}.bin.gz", "wb") as fh, gzip.GzipFile(filename="", mode="wb", fileobj=fh, compresslevel=9, mtime=0) as f:   # mtime=0: same bytes on every build
        f.write(raw)
    print(f"{name}: cells={arr.shape[1]} weeks={arr.shape[2]} series={arr.shape[0]} raw={len(raw)/1e6:.1f} MB gz={(OUT / f'{name}.bin.gz').stat().st_size/1e6:.2f} MB")


GRID_ORDER = ["grid_europe", "grid_africa", "grid_south_america"]     # display order; other grids follow alphabetically


def write_registry(entries: list[dict]) -> None:
    rank = lambda e: (GRID_ORDER.index(e["id"]) if e["id"] in GRID_ORDER else len(GRID_ORDER), e["id"])
    (OUT / "grids.json").write_text(json.dumps({"grids": sorted(entries, key=rank)}, ensure_ascii=False, indent=1), encoding="utf-8")


def build_europe():
    from kelvin367_harmonization.weekly import areas, continuous
    lag = policy.GRID_LAG
    weeks = pd.date_range("2003-01-06", policy.lagged_end(lag), freq="7D")
    loader = areas.AreaLoader()
    parts = []
    for key in config.GRID_COUNTRIES:
        print("grid_europe", key, flush=True)
        arch, api = loader.parts(key)
        df = continuous.assemble(arch, api, split_year=config.SPLIT_YEAR, profile=config.DEFAULT_PROFILE)
        parts.append(build(df[["time_utc", "lat", "lon", "platform", "daynight"]], weeks, SERIES_ALL))
    cells, arr, total, clamped = to_arrays(merge(parts), len(SERIES_ALL), len(weeks))
    meta = common_meta(
        "grid_europe", "Europe 2003-2026 (Ukraine, Spain, Portugal, Greece, Italy)", weeks, SERIES_ALL, cells, total, clamped,
        valid_platforms=["MODIS", "SNPP", "NOAA20", "NOAA21"],
        links=config.link_specs(),
        baseline_years=list(config.BASELINE_YEARS), drift={"ref": list(config.DRIFT_REF_YEARS), "last": 2026}, naive_cutoff=config.NAIVE_CUTOFF,
        geometry_note=("Natural Earth country polygons (Ukraine point of view: Crimea is part of Ukraine) of Ukraine, Spain (mainland and Balearics), Portugal (mainland), Greece and Italy on cells of 0.5 degrees; "
                       "border cells are partial and cells with fewer than 10 detections are omitted."),
        filter_note=("one record: yearly archives up to 2024 (Terra, Aqua, S-NPP) and the FIRMS API from 2025 (NOAA-20 and NOAA-21 from the API throughout); "
                     "confidence filter and persistent-pixel rule, no `type` filter"),
        filter_profile=firms.profile_info(config.DEFAULT_PROFILE),
        data_policy={"lag_days": lag, "as_of": policy.as_of().isoformat(), "reason": "contains Ukraine: no near-real-time publication"})
    write("grid_europe", meta, arr)
    return {"id": "grid_europe", "from": meta["weeks"][0], "to": meta["weeks"][-1], "platforms": meta["valid_platforms"], "cells": len(cells)}


def main() -> int:
    import argparse

    ap = argparse.ArgumentParser(description="Build app/data/grid_europe.{meta.json,bin.gz} and grids.json.")
    ap.add_argument("--as-of", help="build date YYYY-MM-DD for the publication lag (default: KELVIN_AS_OF or today)")
    policy.set_as_of(ap.parse_args().as_of)
    entry = build_europe()
    reg = json.loads((OUT / "grids.json").read_text(encoding="utf-8"))["grids"] if (OUT / "grids.json").exists() else []
    write_registry([e for e in reg if e["id"] != entry["id"]] + [entry])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
