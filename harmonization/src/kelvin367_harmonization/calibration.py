"""Estimate day/night calibration factors from overlapping weekly observations."""

from __future__ import annotations

import numpy as np
import pandas as pd


def _geometric_ratio(target: pd.Series, source: pd.Series, min_count: int) -> tuple[float, int]:
    valid = (target >= min_count) & (source >= min_count)
    if not valid.any():
        raise ValueError(f"no overlapping weeks with both counts >= {min_count}")
    return float(np.exp(np.log(target[valid] / source[valid]).mean())), int(valid.sum())


def estimate_link(weekly: pd.DataFrame, *, min_count: int = 3) -> dict:
    """Return target-per-source factors for day and night.

    ``weekly`` must contain ``source_day``, ``target_day``, ``source_night``
    and ``target_night``. The estimator matches the Kelvin367 calibration
    chain: the geometric mean of weekly ratios over valid overlap weeks.
    """
    required = {"source_day", "target_day", "source_night", "target_night"}
    missing = required - set(weekly.columns)
    if missing:
        raise ValueError(f"missing columns: {', '.join(sorted(missing))}")
    k_day, day_weeks = _geometric_ratio(weekly.target_day, weekly.source_day, min_count)
    k_night, night_weeks = _geometric_ratio(weekly.target_night, weekly.source_night, min_count)
    return {
        "k_day": k_day,
        "k_night": k_night,
        "day_weeks": day_weeks,
        "night_weeks": night_weeks,
        "min_count": min_count,
        "estimator": "geometric_mean_of_weekly_ratios",
    }

