"""Single source of the product configuration: areas, calibration windows, splits, defaults.

Everything the published files depend on lives here. Evaluation scripts that deliberately use
other windows (hold-out tests, interval calibration on 2020-2021) keep their own values and say so; the product (presets, grids, the
quickstart notebook) takes them from this module.
"""
from __future__ import annotations

# --- areas -------------------------------------------------------------------------------------------------------------------------------
IBERIA_BBOX = (-10.0, 35.5, 4.5, 44.0)          # west, south, east, north of the FIRMS API rectangle that holds Spain and Portugal
AREAS: dict[str, dict] = {
    # id: display name, Natural Earth names (mask), archive countries, API rectangle name, bbox that cuts the mask
    "ukraine": dict(name="Ukraine", ne=["Ukraine"], arch=["Ukraine"], api="ukraine", bbox=(22.0, 44.0, 40.5, 52.5)),
    "spain": dict(name="Spain (mainland and Balearics)", ne=["Spain"], arch=["Spain"], api="iberia", bbox=IBERIA_BBOX),
    "portugal": dict(name="Portugal (mainland)", ne=["Portugal"], arch=["Portugal"], api="iberia", bbox=IBERIA_BBOX),
    "iberia": dict(name="Iberia: Spain + Portugal", ne=["Spain", "Portugal"], arch=["Spain", "Portugal"], api="iberia", bbox=IBERIA_BBOX),
    "greece": dict(name="Greece", ne=["Greece"], arch=["Greece"], api="greece", bbox=(19.0, 34.5, 29.8, 42.0)),
    "italy": dict(name="Italy", ne=["Italy"], arch=["Italy"], api="italy", bbox=(6.5, 35.4, 18.8, 47.2)),
}
GRID_COUNTRIES = ("ukraine", "spain", "portugal", "greece", "italy")     # areas that make up grid_europe

# --- record -------------------------------------------------------------------------------------------------------------------------------
DEFAULT_PROFILE = "conf_persistent"             # filter profile of the continuous records (firms.FILTER_PROFILES)
SPLIT_YEAR = 2025                               # archives (Terra, Aqua, S-NPP) before it, the FIRMS API from it
NAIVE_CUTOFF = "2012-01-01"                     # raw MODIS before, raw VIIRS after (the stitched series that users would build)
FIRST_WEEK = "2003-01-06"                      # first Monday of the weekly tables
VIIRS_FIRST_WEEK = "2012-01-23"                 # first week of the converted S-NPP series

# --- calibration chain --------------------------------------------------------------------------------------------------------------------
# training windows (inclusive ISO dates) of the links of the product: S-NPP -> MODIS, S-NPP -> NOAA-20, NOAA-20 -> NOAA-21
LINK_TRAIN: dict[tuple[str, str], tuple[str, str]] = {
    ("SNPP", "MODIS"): ("2012-01-01", "2021-12-31"),
    ("SNPP", "NOAA20"): ("2018-04-01", "2023-12-31"),
    ("NOAA20", "NOAA21"): ("2024-01-17", "2025-06-30"),
}
BASELINE_YEARS = (2003, 2021)                   # years of the seasonal norm (inclusive)
DRIFT_REF_YEARS = (2012, 2019)                  # reference years of the Terra/Aqua drift model


def link_specs() -> list[dict]:
    """The links as the grids store them: [{"source", "target", "train": [from, to]}]."""
    return [{"source": s, "target": t, "train": list(w)} for (s, t), w in LINK_TRAIN.items()]


def archive_years() -> range:
    return range(2003, SPLIT_YEAR)
