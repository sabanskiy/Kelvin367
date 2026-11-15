"""Registry of the fire-detecting sensors/platforms and how they chain together.

Dates for FIRMS availability were verified through the FIRMS `data_availability` API on 2026-10-05.
Local overpass times are nominal.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class Platform:
    name: str            # canonical name used in dataframes
    family: str          # "MODIS" or "VIIRS"
    firms_code: str      # value of the `satellite` column in FIRMS CSV files
    start: date          # first date available in FIRMS
    end: date | None     # last date of delivery; None = still operating
    nominal_local_time: str
    note: str = ""
    planned_end: str = ""  # human-readable; sources disagree for MODIS


PLATFORMS: dict[str, Platform] = {
    p.name: p
    for p in (
        Platform("Terra", "MODIS", "Terra", date(2000, 11, 1), None, "10:30 / 22:30",
                 "Drifting to earlier local time since 2022; Terra-only before mid-2002.",
                 planned_end="science data collection ~2027-01 (NASA/LAADS plan; still delivering on 2026-09-30)"),
        Platform("Aqua", "MODIS", "Aqua", date(2002, 7, 4), None, "13:30 / 01:30",
                 "Drifting to later local time since 2022. Start date from background knowledge, not verified.",
                 planned_end="~2026-08 per LAADS plan (Apr 2025), ~2027-09 per later sources; still delivering on 2026-09-30"),
        Platform("SNPP", "VIIRS", "N", date(2012, 1, 20), date(2026, 11, 2), "13:30 / 01:30",
                 "Delivery ceased 2026-11-02 13:00 UTC (FIRMS blog 2026-10-27; the first notice said 2026-11-01); the archive stays available.",
                 planned_end="2026-11-02 13:00 UTC (NASA FIRMS blog 2026-10-27; earlier NASA Earthdata / NOAA NESDIS notice said 2026-11-01)"),
        Platform("NOAA20", "VIIRS", "N20", date(2018, 4, 1), None, "13:30 / 01:30 (offset)",
                 "FIRMS standard processing from 2018-04-01."),
        Platform("NOAA21", "VIIRS", "N21", date(2024, 1, 17), None, "13:30 / 01:30 (offset)",
                 "FIRMS near-real-time only; shortest overlap with SNPP (~2.7 years)."),
    )
}

FIRMS_CODE_TO_PLATFORM = {p.firms_code: p.name for p in PLATFORMS.values()}

# Calibration chain: each link is estimated on the overlap of the two platforms.
CHAIN: list[tuple[str, str]] = [("Terra+Aqua", "SNPP"), ("SNPP", "NOAA20"), ("NOAA20", "NOAA21")]


def overlap(a: str, b: str) -> tuple[date, date] | None:
    """Overlap of two platforms (or MODIS pair 'Terra+Aqua') in FIRMS, or None."""
    def span(name: str):
        if name == "Terra+Aqua":
            return max(PLATFORMS["Terra"].start, PLATFORMS["Aqua"].start), None
        p = PLATFORMS[name]
        return p.start, p.end

    (s1, e1), (s2, e2) = span(a), span(b)
    start = max(s1, s2)
    ends = [e for e in (e1, e2) if e is not None]
    end = min(ends) if ends else None
    if end is not None and end < start:
        return None
    return start, end


@dataclass(frozen=True)
class Gap:
    platform: str
    start: date
    end: date
    note: str = "no records in the Ukraine and Iberia bbox AOIs while the other VIIRS platform has >= 30 records/day"

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1


# Satellite-wide delivery gaps found on 2026-10-05 (analysis/chain_calibration_long.py, spans of >= 2 days).
# Only the S-NPP/NOAA-20 overlap (2018-04-01 onward) was checked; earlier years and MODIS are not covered.
KNOWN_GAPS: list[Gap] = [
    Gap("SNPP", date(2022, 7, 27), date(2022, 8, 10)),
    Gap("SNPP", date(2024, 5, 30), date(2024, 6, 3)),
    Gap("SNPP", date(2024, 7, 10), date(2024, 7, 15)),
    Gap("SNPP", date(2024, 7, 25), date(2024, 7, 28)),
    Gap("SNPP", date(2024, 11, 3), date(2024, 11, 5)),
    Gap("SNPP", date(2026, 3, 10), date(2026, 3, 12)),
    Gap("SNPP", date(2026, 4, 28), date(2026, 6, 2)),
    Gap("SNPP", date(2026, 7, 11), date(2026, 7, 15)),
    Gap("NOAA20", date(2023, 7, 19), date(2023, 7, 22)),
    Gap("NOAA20", date(2024, 2, 4), date(2024, 2, 5)),
    Gap("NOAA21", date(2024, 2, 27), date(2024, 3, 6)),
]


def in_known_gap(platform: str, day: date) -> bool:
    return any(g.platform == platform and g.start <= day <= g.end for g in KNOWN_GAPS)
