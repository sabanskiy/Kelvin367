"""Publication policy for the data files of the app; formerly scripts/data_policy.py.

Ukrainian areas are not published in near-real time: the record ends at least LAG_DAYS days before the build date. The value (30 days) is
a default awaiting the team decision; change it here and rebuild. The `grid_europe` set contains Ukraine, so the lag applies to
the whole set (Iberia loses the last weeks only in the custom-area mode, the Iberia presets keep the full record).

Set KELVIN_AS_OF=YYYY-MM-DD, or pass --as-of to the build scripts, to build for a fixed date: the output is then a pure function of the raw files
and that date (reproducible builds and tests). Without it the build date is today.
"""
from __future__ import annotations

import os
from datetime import date, timedelta

LAG_DAYS = {"ukraine": 30}
GRID_LAG = max(LAG_DAYS.values())
DEFAULT_END = "2026-09-28"      # last complete week with data in the downloaded files (Monday)


def set_as_of(value: str | date | None) -> None:
    """Fix the build date for this process (the --as-of option of the build scripts); None leaves KELVIN_AS_OF or today."""
    if value:
        os.environ["KELVIN_AS_OF"] = value.isoformat() if isinstance(value, date) else str(value)
        date.fromisoformat(os.environ["KELVIN_AS_OF"])      # fails early on a malformed date


def as_of() -> date:
    v = os.environ.get("KELVIN_AS_OF")
    return date.fromisoformat(v) if v else date.today()


def lagged_end(lag_days: int, default_end: str = DEFAULT_END, today: date | None = None) -> str:
    """Monday (ISO) of the last week that ends at least `lag_days` before `today`, capped by `default_end`."""
    today = today or as_of()
    last_day = today - timedelta(days=lag_days)       # the last day that may be published
    monday = last_day - timedelta(days=6)              # a week Monday..Sunday must end on or before last_day
    monday -= timedelta(days=monday.weekday())
    return min(monday.isoformat(), default_end)
