"""One continuous record per area (2003 -> now) from the FIRMS yearly country archives and the FIRMS Area API.

Why: the archives (MODIS 2000-2024, S-NPP 2012-2024, no NOAA-20/21) and the API (all platforms, 2018 onward, rectangles) were two
separate records with different geometry and filters. Here both are cut by the same mask (country polygon intersected with the API
rectangle) and filtered by one profile (`conf_persistent`), and every platform comes from exactly one source in each period:

    Terra, Aqua, S-NPP : archives up to and including `split_year - 1`, API from `split_year`
    NOAA-20, NOAA-21   : API throughout (not in the archives)

The mask makes the geometry identical by construction; the match of the two sources over their overlap (2018-2024) is checked in
eval/continuous_validation.py.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from . import config, firms

ROOT = Path(__file__).resolve().parents[3]
# Ukraine point of view: Crimea and all occupied territories are part of Ukraine (the default Natural Earth file puts Crimea in Russia).
# For the preset countries only Ukraine and Russia differ between the two files.
NATURAL_EARTH = ROOT / "data" / "raw" / "naturalearth" / "ne_10m_admin_0_countries_ukr.geojson"
NATURAL_EARTH_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries_ukr.geojson"
ARCHIVE_PLATFORMS = ("Terra", "Aqua", "SNPP")
API_ONLY_PLATFORMS = ("NOAA20", "NOAA21")


def country_mask(names, bbox=None, path: Path = NATURAL_EARTH):
    """Union of Natural Earth admin-0 polygons by NAME, optionally intersected with bbox = (lon0, lat0, lon1, lat1)."""
    import shapely
    from shapely.geometry import box, shape

    if not Path(path).exists():
        raise FileNotFoundError(f"{path} is missing; download it from {NATURAL_EARTH_URL} (see DATA.md)")
    feats = json.loads(Path(path).read_text(encoding="utf-8"))["features"]
    geoms = [shape(f["geometry"]) for f in feats if f["properties"].get("NAME") in set(names)]
    if len(geoms) != len(set(names)):
        raise ValueError(f"not all of {names} found in {path}")
    g = shapely.union_all(geoms)
    if bbox is not None:
        g = g.intersection(box(*bbox))
    return g


def in_mask(df: pd.DataFrame, geom) -> pd.DataFrame:
    """Rows whose (lon, lat) lie inside `geom`."""
    import shapely

    if df.empty:
        return df
    shapely.prepare(geom)
    ok = shapely.contains_xy(geom, df["lon"].to_numpy(dtype=float), df["lat"].to_numpy(dtype=float))
    return df[ok]


def select_sources(archive: pd.DataFrame, api: pd.DataFrame, split_year: int = config.SPLIT_YEAR) -> pd.DataFrame:
    """One source per platform and period, before any filter: archives for Terra, Aqua, S-NPP up to `split_year`, the API afterwards
    and always for NOAA-20/21. The column `source` ("archive" or "api") says which one a row came from."""
    cut = pd.Timestamp(f"{split_year}-01-01", tz="UTC")
    a = archive[archive["platform"].isin(ARCHIVE_PLATFORMS) & (archive["time_utc"] < cut)].assign(source="archive")
    p_api = api["platform"]
    b = api[p_api.isin(API_ONLY_PLATFORMS) | (p_api.isin(ARCHIVE_PLATFORMS) & (api["time_utc"] >= cut))].assign(source="api")
    return pd.concat([a, b], ignore_index=True)


def assemble(archive: pd.DataFrame, api: pd.DataFrame, split_year: int = config.SPLIT_YEAR, profile: str = config.DEFAULT_PROFILE,
             static: np.ndarray | None = None) -> pd.DataFrame:
    """Combine archive and API detections (already cut by the same mask) into one filtered record, one source per platform and period."""
    both = select_sources(archive, api, split_year)
    out = firms.apply_profile(both, profile)
    if static is not None:
        out = firms.drop_pixels(out, static)
    return out


def static_mask(archive: pd.DataFrame, api: pd.DataFrame, min_days: int = firms.STATIC_MIN_DAYS, min_share: float = 0.0) -> np.ndarray:
    """Static-source pixels of an area from the rows that carry a `type` (archives and standard-processing API files)."""
    known = pd.concat([archive, api[api["type"] != firms.UNKNOWN_TYPE]], ignore_index=True)
    return firms.static_pixels(known, min_days=min_days, min_share=min_share)


def overlap_table(archive: pd.DataFrame, api: pd.DataFrame, start: str, end: str, platforms=ARCHIVE_PLATFORMS) -> pd.DataFrame:
    """Weekly counts of the same platforms from the two sources over their overlap (for the splice check)."""
    out = {}
    for name, d in (("archive", archive), ("api", api)):
        d = d[d["platform"].isin(platforms)]
        t = d["time_utc"].dt.tz_localize(None)
        d = d[(t >= start) & (t <= end)]
        wk = d["time_utc"].dt.tz_localize(None).dt.to_period("W-SUN").dt.start_time
        out[name] = d.groupby([wk, d["platform"]]).size()
    return pd.DataFrame(out).fillna(0).astype(int)
