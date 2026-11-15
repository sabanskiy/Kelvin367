"""Preset areas as data: country-masked detections of the continuous record and its weekly platform table.

`AreaLoader` holds the loaded files of one session explicitly (the FIRMS API rectangles and the country archives are large), so there is
no module-level state: create one loader per script and reuse it.
"""
from __future__ import annotations

import pandas as pd

from . import chain, config, continuous, firms, policy


class AreaLoader:
    def __init__(self) -> None:
        self._api: dict[str, pd.DataFrame] = {}
        self._arch: dict[str, pd.DataFrame] = {}

    def parts(self, key: str) -> tuple[pd.DataFrame, pd.DataFrame]:
        """(archive rows, API rows) of one preset area cut by the area mask, before any filter profile."""
        a = config.AREAS[key]
        geom = continuous.country_mask(a["ne"], a["bbox"])
        if a["api"] not in self._api:
            self._api[a["api"]] = firms.load_api(a["api"])
        api = continuous.in_mask(self._api[a["api"]], geom)
        for c in a["arch"]:
            if c not in self._arch:
                self._arch[c] = firms.load_country(c, years=config.archive_years())
        arch = pd.concat([self._arch[c] for c in a["arch"]], ignore_index=True)
        return continuous.in_mask(arch, geom), api

    def record(self, key: str, split_year: int = config.SPLIT_YEAR, profile: str = config.DEFAULT_PROFILE,
               static_min_days: int | None = None, static_min_share: float = 0.0) -> tuple[pd.DataFrame, pd.DataFrame]:
        """(detections, weekly platform table) of one preset area: country mask, archives + API, one filter profile."""
        arch, api = self.parts(key)
        static = continuous.static_mask(arch, api, static_min_days, static_min_share) if static_min_days else None
        df = continuous.assemble(arch, api, split_year=split_year, profile=profile, static=static)
        end = policy.lagged_end(policy.LAG_DAYS.get(key, 0))
        return df, chain.weekly_platform_table(df, config.FIRST_WEEK, end)


def frp_table(df: pd.DataFrame, end: str) -> pd.DataFrame:
    """Weekly sums of fire radiative power (MW) with the same layout as chain.weekly_platform_table (group, day/night columns)."""
    t = df["time_utc"].dt.tz_localize(None) if df["time_utc"].dt.tz is not None else df["time_utc"]
    g = pd.DataFrame({"week": t.dt.to_period("W-SUN").dt.start_time.values, "grp": df["platform"].map(chain.GROUP).values,
                      "dn": df["daynight"].values, "frp": pd.to_numeric(df["frp"], errors="coerce").fillna(0.0).values})
    s = g.groupby(["week", "grp", "dn"]).frp.sum().unstack(["grp", "dn"], fill_value=0.0)
    return s.reindex(pd.date_range(config.FIRST_WEEK, end, freq="7D"), fill_value=0.0)
