"""Loading and normalising FIRMS yearly country archives (MODIS and VIIRS S-NPP)."""
from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import pandas as pd

from .sensors import FIRMS_CODE_TO_PLATFORM

RAW = Path(__file__).resolve().parents[3] / "data" / "raw" / "firms"

# FIRMS `type`: 0 presumed vegetation fire, 1 active volcano, 2 other static land source, 3 offshore
VEGETATION = 0
# FIRMS near-real-time (NRT) files from the API have no `type` column, so static sources cannot be flagged there.
UNKNOWN_TYPE = -1


def load_file(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, dtype={"acq_time": str, "confidence": str, "acq_date": str})
    if df.empty:  # header-only file: a window without detections
        return pd.DataFrame()
    modis = "MODIS" in df["instrument"].iloc[0] if len(df) else path.name.startswith("modis")
    out = pd.DataFrame(
        {
            "lat": df["latitude"],
            "lon": df["longitude"],
            "frp": df["frp"],
            "daynight": df["daynight"],
            "type": df["type"] if "type" in df.columns else UNKNOWN_TYPE,
            "sensor": "MODIS" if modis else "VIIRS",
            "platform": df["satellite"].map(FIRMS_CODE_TO_PLATFORM),
            # brightness temperatures of the fire pixel, K: ~4 um (MODIS `brightness`, VIIRS I4) and ~11 um (MODIS band 31, VIIRS I5).
            # Not comparable between sensors: different channels and saturation (VIIRS I4 is capped at 367 K).
            "bt4_k": pd.to_numeric(df["brightness" if modis else "bright_ti4"], errors="coerce").astype("float32"),
            "bt11_k": pd.to_numeric(df["bright_t31" if modis else "bright_ti5"], errors="coerce").astype("float32"),
            "scan_km": pd.to_numeric(df["scan"], errors="coerce").astype("float32"),     # pixel size across the scan, km
            "track_km": pd.to_numeric(df["track"], errors="coerce").astype("float32"),   # pixel size along the track, km
        }
    )
    t = df["acq_time"].str.zfill(4)
    out["time_utc"] = pd.to_datetime(df["acq_date"] + " " + t.str[:2] + ":" + t.str[2:], utc=True)
    if modis:
        out["conf_ok"] = pd.to_numeric(df["confidence"], errors="coerce") >= 30
    else:
        out["conf_ok"] = df["confidence"].isin(["n", "h"])
    # local mean solar time, hours; independent of political time zones
    out["solar_hour"] = (out["time_utc"].dt.hour + out["time_utc"].dt.minute / 60 + out["lon"] / 15) % 24
    return out


def load_country(country: str, years=range(2012, 2025), raw: Path = RAW) -> pd.DataFrame:
    frames = []
    for sensor in ("modis", "viirs-snpp"):
        for y in years:
            p = raw / f"{sensor}_{y}_{country}.csv"
            if p.exists() and p.stat().st_size > 0:
                part = load_file(p)
                if len(part):
                    frames.append(part)
    df = pd.concat(frames, ignore_index=True)
    df["country"] = country
    df["product"] = "archive"
    return df


API_RAW = Path(__file__).resolve().parents[3] / "data" / "raw" / "firms_api"


def load_api(aoi: str, raw: Path = API_RAW) -> pd.DataFrame:
    """Load files written by scripts/download_firms_api.py for one AOI (all sources).

    A day can appear in two files if a NRT file was fetched before the SP version existed; duplicates
    on (time, lat, lon, platform) are dropped, keeping the last file read.
    """
    frames = []
    for src_dir in sorted(p for p in raw.glob("*") if p.is_dir()):
        for f in sorted((src_dir / aoi).glob("*.csv")) if (src_dir / aoi).exists() else []:
            if f.stat().st_size > 0:
                part = load_file(f)
                if len(part):
                    part["product"] = "NRT" if src_dir.name.endswith("_NRT") else "SP"
                    frames.append(part)
    if not frames:
        return pd.DataFrame()
    df = pd.concat(frames, ignore_index=True)
    df["country"] = aoi
    return df.drop_duplicates(["time_utc", "lat", "lon", "platform"], keep="last").reset_index(drop=True)


PERSISTENT_DAYS = 10
PERSISTENT_GRID = 0.01


def persistent_pixels(df: pd.DataFrame, min_days: int = PERSISTENT_DAYS, grid: float = PERSISTENT_GRID) -> np.ndarray:
    """Boolean array (positional): rows whose pixel has detections on at least `min_days` distinct days of its calendar month.

    A pixel is a `grid`-degree cell (0.01 degrees, about 1 km) of one platform. Static sources (industrial flares, plants) repeat day
    after day, ordinary vegetation fires do not; long-burning peat fires are the known exception and may be removed too.
    """
    t = df["time_utc"].dt.tz_localize(None) if df["time_utc"].dt.tz is not None else df["time_utc"]
    key = pd.DataFrame({"p": df["platform"].to_numpy(), "m": t.dt.to_period("M").astype(str).to_numpy(), "d": t.dt.floor("D").to_numpy(),
                        "y": np.round(df["lat"].to_numpy() / grid).astype(np.int64), "x": np.round(df["lon"].to_numpy() / grid).astype(np.int64)})
    days = key.groupby(["p", "m", "y", "x"])["d"].transform("nunique")
    return (days >= min_days).to_numpy()


def natural(df: pd.DataFrame, keep_unknown_type: bool = True, drop_persistent: bool = True) -> pd.DataFrame:
    """Rows presumed to be vegetation fires with acceptable confidence.

    NRT rows have unknown `type`; they are kept by default (flagged by type == UNKNOWN_TYPE) because
    dropping them would remove all of the most recent months. Static sources cannot be flagged by `type` there, so with
    `drop_persistent` (default) unknown-type rows in pixels that are active on >= PERSISTENT_DAYS days of a month are removed
    (about 2-4% of the NRT detections in Ukraine in an August 2026 check). Rows with a known type are never
    affected, so yearly archives and SP files give the same result as before.
    """
    ok = df["type"] == VEGETATION
    if keep_unknown_type:
        unk = (df["type"] == UNKNOWN_TYPE).to_numpy()
        if drop_persistent and unk.any():
            pers = np.zeros(len(df), dtype=bool)
            pers[unk] = persistent_pixels(df[unk])
            unk = unk & ~pers
        ok |= unk
    return df[ok & df["conf_ok"]]


def conf_only(df: pd.DataFrame, drop_persistent: bool = True) -> pd.DataFrame:
    """Rows with acceptable confidence and, by default, without persistent pixels, for ALL platforms alike.

    Used for series that mix platforms with and without a `type` field (NOAA-21 and NRT have none), so that every platform is
    filtered the same way: the `type` field is ignored and static sources are removed by the persistent-pixel rule only.
    """
    ok = df["conf_ok"].to_numpy()
    if drop_persistent and len(df):
        ok = ok & ~persistent_pixels(df)
    return df[ok]


# Named filter profiles: one place that says which detections count as "fire records" in each kind of dataset.
# Every dataset the app ships records the profile it was built with (`filter_profile` in its metadata).
FILTER_PROFILES = {
    "archive_type0": "country archives: `type` == 0 (presumed vegetation fire) and confidence ok",
    "api_conf_persistent": "FIRMS API rectangles: confidence ok, persistent pixels removed (>= 10 days/month in a 0.01 degree pixel); `type` ignored because NOAA-21 and NRT files have none",
    "conf_persistent": "continuous records (archives + API): confidence ok, persistent pixels removed; `type` ignored so that every platform and period is filtered the same way",
    "conf_persistent_static": "continuous records: confidence ok, persistent pixels removed, and pixels that FIRMS flagged by `type` (volcano, static land source, offshore) on >= 3 days removed from every platform",
    "api_conf": "FIRMS API rectangles: confidence ok only (legacy profile used until 2026-10-09; kept to reproduce older documents)",
}
DEFAULT_API_PROFILE = "api_conf_persistent"
_ALIASES = {"persistent": "api_conf_persistent", "conf": "api_conf"}


def apply_profile(df: pd.DataFrame, name: str | None = None, platforms=None) -> pd.DataFrame:
    """Apply a named filter profile (see FILTER_PROFILES) and optionally keep only `platforms`.

    `name=None` takes the environment variable KELVIN_FILTER ("persistent" / "conf" or a profile name) and otherwise the
    default API profile, so analysis scripts can reproduce older numbers with KELVIN_FILTER=conf.
    """
    name = name or os.environ.get("KELVIN_FILTER") or DEFAULT_API_PROFILE
    name = _ALIASES.get(name, name)
    if name not in FILTER_PROFILES:
        raise ValueError(f"unknown filter profile {name!r}; known: {sorted(FILTER_PROFILES)}")
    if platforms is not None:
        df = df[df["platform"].isin(list(platforms))]
    if name == "archive_type0":
        return natural(df, keep_unknown_type=False, drop_persistent=False)
    if name == "api_conf":
        return df[df["conf_ok"]]
    return conf_only(df)  # api_conf_persistent, conf_persistent and conf_persistent_static start from the same rule


def profile_info(name: str) -> dict:
    name = _ALIASES.get(name, name)
    return {"name": name, "description": FILTER_PROFILES[name]}


STATIC_TYPES = (1, 2, 3)      # volcano, other static land source, offshore (FIRMS `type`)
STATIC_MIN_DAYS = 3


def _pixel_keys(df: pd.DataFrame, grid: float = PERSISTENT_GRID) -> np.ndarray:
    y = np.round(df["lat"].to_numpy(dtype=float) / grid).astype(np.int64)
    x = np.round(df["lon"].to_numpy(dtype=float) / grid).astype(np.int64)
    return y * 1_000_000 + (x + 500_000)


def static_pixels(df: pd.DataFrame, min_days: int = STATIC_MIN_DAYS, types=STATIC_TYPES, grid: float = PERSISTENT_GRID,
                  min_share: float = 0.0) -> np.ndarray:
    """Pixel keys (0.01 degrees) that FIRMS itself flagged as non-vegetation sources (`type` in `types`) on at least `min_days` distinct days.

    `min_share` additionally requires that those days are at least that share of all days with a detection in the pixel (so a pixel in which
    real vegetation fires dominate is kept even if a static source sits in it). `df` should hold rows whose `type` is known (archives and
    standard-processing files). The result is applied to every platform, also to those that have no `type` (NOAA-21, near-real-time
    files), so that the filtering is symmetric.
    """
    t = df["time_utc"]
    day = (t.dt.tz_localize(None) if t.dt.tz is not None else t).dt.floor("D")
    keys = pd.DataFrame({"k": _pixel_keys(df, grid), "d": day.to_numpy(), "s": df["type"].isin(list(types)).to_numpy()})
    n_all = keys.groupby("k")["d"].nunique()
    n_static = keys[keys["s"]].groupby("k")["d"].nunique()
    if n_static.empty:
        return np.array([], dtype=np.int64)
    share = (n_static / n_all.reindex(n_static.index)).fillna(0)
    ok = (n_static >= min_days) & (share >= min_share)
    return ok[ok].index.to_numpy(dtype=np.int64)


def drop_pixels(df: pd.DataFrame, pixels: np.ndarray, grid: float = PERSISTENT_GRID) -> pd.DataFrame:
    """Rows outside the given pixel keys."""
    if len(pixels) == 0 or df.empty:
        return df
    return df[~np.isin(_pixel_keys(df, grid), pixels)]
