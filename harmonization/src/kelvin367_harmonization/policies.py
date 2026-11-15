"""Equal-mix and VIIRS-first policies over calibrated daily group counts."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import numpy as np
import pandas as pd

GROUP_BITS = {"MODIS": 1, "SNPP": 2, "NOAA20": 4}
KEYS = ["date", "cell_iy", "cell_ix"]


@dataclass(frozen=True)
class Availability:
    start: date
    end: date | None = None
    gaps: tuple[tuple[date, date], ...] = ()

    def available(self, day: date) -> bool:
        scheduled = day >= self.start and (self.end is None or day <= self.end)
        return scheduled and not any(start <= day <= end for start, end in self.gaps)


def _available(availability: dict[str, Availability], group: str, days: pd.Series) -> np.ndarray:
    if group not in availability:
        raise ValueError(f"availability is missing {group}")
    return np.asarray([availability[group].available(day) for day in days], dtype=bool)


def harmonize_daily(
    calibrated_groups: pd.DataFrame,
    availability: dict[str, Availability],
    viirs_weights: dict[str, float],
) -> pd.DataFrame:
    """Compute both daily policies from MODIS-equivalent group counts.

    Counts must already be calibrated to the MODIS scale. A zero on an
    available platform means an observed zero; an unavailable platform is
    excluded by the availability calendar.
    """
    required = set(KEYS + list(GROUP_BITS))
    missing = required - set(calibrated_groups.columns)
    if missing:
        raise ValueError(f"missing columns: {', '.join(sorted(missing))}")
    if calibrated_groups.duplicated(KEYS).any():
        raise ValueError("duplicate date/cell rows")
    if any(float(viirs_weights.get(platform, 0.0)) < 0 for platform in ("SNPP", "NOAA20")):
        raise ValueError("VIIRS weights must be nonnegative")

    out = calibrated_groups.copy()
    out["date"] = pd.to_datetime(out.date).dt.tz_localize(None).dt.normalize()
    days = out.date.dt.date

    equal_num = np.zeros(len(out), dtype=float)
    equal_den = np.zeros(len(out), dtype=np.int8)
    equal_source = np.zeros(len(out), dtype=np.int8)
    available_by_group: dict[str, np.ndarray] = {}
    for group, bit in GROUP_BITS.items():
        available = _available(availability, group, days)
        available_by_group[group] = available
        values = out[group].fillna(0.0).to_numpy(dtype=float)
        equal_num += np.where(available, values, 0.0)
        equal_den += available.astype(np.int8)
        equal_source |= np.where(available, bit, 0).astype(np.int8)
    out["equal_mix_count_1d"] = np.divide(
        equal_num,
        equal_den,
        out=np.full(len(out), np.nan),
        where=equal_den > 0,
    ).astype("float32")
    out["equal_mix_source"] = equal_source

    viirs_num = np.zeros(len(out), dtype=float)
    viirs_den = np.zeros(len(out), dtype=float)
    viirs_source = np.zeros(len(out), dtype=np.int8)
    for group in ("SNPP", "NOAA20"):
        weight = float(viirs_weights.get(group, 0.0))
        use = available_by_group[group] & (weight > 0)
        viirs_num += np.where(use, weight * out[group].fillna(0.0).to_numpy(dtype=float), 0.0)
        viirs_den += np.where(use, weight, 0.0)
        viirs_source |= np.where(use, GROUP_BITS[group], 0).astype(np.int8)
    has_viirs = viirs_den > 0
    viirs_value = np.divide(viirs_num, viirs_den, out=np.zeros(len(out)), where=has_viirs)
    has_modis = available_by_group["MODIS"]
    modis = out.MODIS.fillna(0.0).to_numpy(dtype=float)
    out["viirs_first_count_1d"] = np.where(has_viirs, viirs_value, np.where(has_modis, modis, np.nan)).astype("float32")
    out["viirs_first_source"] = np.where(has_viirs, viirs_source, np.where(has_modis, GROUP_BITS["MODIS"], 0)).astype(np.int8)
    before_viirs = np.asarray(days) < availability["SNPP"].start
    out["viirs_first_flag"] = np.select(
        [has_viirs, has_modis & before_viirs, has_modis],
        ["viirs", "pre_viirs", "fallback"],
        default="no_source",
    )
    return out

