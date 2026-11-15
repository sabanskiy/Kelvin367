"""Is the harmonized record comparable before and after the start of VIIRS (2012) when judged by burned area?

Reference: MODIS burned area MCD64A1 v6.1 (500 m, monthly, 2003-2024) summed over the same country masks as the calendar presets. It is
a MODIS-reflectance product, so it does not change with the VIIRS record; it does use MODIS active fires as a helper, therefore it is
independent of VIIRS but not of MODIS hotspots.

For each preset and each hotspot series, in months with enough detections and burned area, r = ln(burned ha / series). A transition
artefact shows as a step in r between the years before and after 2012. Step = median r (2013-2018) - median r (2006-2011); year-block
bootstrap 95 % interval over years. Series (monthly sums of the weekly values, a week belongs to the month of its Thursday):
  modis        raw Terra+Aqua counts (control: no transition, expected step 0 up to MODIS ageing)
  naive        raw MODIS until 2012-01, raw S-NPP/VIIRS counts afterwards
  harmonized   harmonized MODIS-equivalent series: MODIS before 2012-01-23, converted S-NPP (harm_viirs) afterwards
  frp_naive    raw MODIS FRP until 2012-01, raw S-NPP FRP afterwards (FRP is physical, no unit conversion)

    python3 eval/eval_burnt_area_2012.py          # needs data/interim/mcd64a1/ from scripts/mcd64a1_extract.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
from kelvin367_harmonization.weekly import config, continuous  # noqa: E402

pd.set_option("display.width", 220)
INTERIM = ROOT / "data" / "interim" / "mcd64a1"
CACHE = ROOT / "data" / "interim" / "mcd64a1_monthly_ha.csv"
HA_PER_PIXEL = (1111950.5197 / 2400) ** 2 / 1e4        # 21.466 ha, equal-area sinusoidal grid
CUT = pd.Timestamp("2012-01-23")                       # first week of the converted S-NPP series
BEFORE, AFTER = (2006, 2011), (2013, 2018)
MIN_SERIES, MIN_HA = 20.0, 50.0
SCALED = ("modis", "naive", "harmonized", "frp_naive")
rng = np.random.default_rng(367)


def load_pixels() -> pd.DataFrame:
    parts = []
    for f in sorted(INTERIM.glob("*/*.npz")):
        z = np.load(f)
        if int(z["n_burned"]):
            year, doy = int(f.name.split(".")[1][1:5]), int(f.name.split(".")[1][5:8])
            month = (pd.Timestamp(year=year, month=1, day=1) + pd.Timedelta(days=doy - 1)).to_period("M")
            parts.append(pd.DataFrame({"lat": z["lat"], "lon": z["lon"], "month": month}))
    return pd.concat(parts, ignore_index=True)


def monthly_ha() -> pd.DataFrame:
    if CACHE.exists():
        return pd.read_csv(CACHE, index_col=0, parse_dates=True)
    px = load_pixels()
    print("burned pixels:", len(px))
    out = {}
    for key, a in config.AREAS.items():
        geom = continuous.country_mask(a["ne"], a["bbox"])
        sel = continuous.in_mask(px[(px.lon >= a["bbox"][0]) & (px.lon <= a["bbox"][2]) & (px.lat >= a["bbox"][1]) & (px.lat <= a["bbox"][3])], geom)
        s = sel.groupby("month").size() * HA_PER_PIXEL
        s.index = s.index.to_timestamp()
        out[key] = s
    df = pd.DataFrame(out).reindex(pd.date_range("2003-01-01", "2024-12-01", freq="MS")).fillna(0.0)
    df.to_csv(CACHE)
    return df


def series(area: str) -> pd.DataFrame:
    d = json.loads((ROOT / "output" / "calendar" / f"{area}.json").read_text(encoding="utf-8"))
    w = pd.to_datetime(d["weeks"])
    s = d["series"]
    f = lambda v: pd.Series([np.nan if x is None else x for x in v], index=w, dtype=float)
    modis, snpp = f(s["modis"]), f(s["viirs_snpp"])
    harm, hv = f(s["harm"]["est"]), f(s["harm_viirs"]["est"])
    pre = w < CUT
    out = pd.DataFrame({
        "modis": modis,
        "naive": np.where(pre, modis, snpp),
        "harmonized": np.where(pre, harm, hv),
        "frp_naive": np.where(pre, f(s["frp_modis"]), f(s["frp_snpp"])),
    }, index=w)
    out.index = out.index + pd.Timedelta(days=3)               # the Thursday decides the month
    m = out.groupby(out.index.to_period("M")).sum(min_count=1)
    m.index = m.index.to_timestamp()
    return m


def yearly_median(r: pd.Series, y0: int, y1: int) -> pd.Series:
    r = r[(r.index.year >= y0) & (r.index.year <= y1)].dropna()
    return r.groupby(r.index.year).median()


def step(r: pd.Series, n_boot: int = 4000) -> tuple[float, float, float, int, int]:
    b, a = yearly_median(r, *BEFORE), yearly_median(r, *AFTER)
    if len(b) < 3 or len(a) < 3:
        return (np.nan, np.nan, np.nan, len(b), len(a))
    point = a.median() - b.median()
    boots = [np.median(rng.choice(a.values, len(a))) - np.median(rng.choice(b.values, len(b))) for _ in range(n_boot)]
    lo, hi = np.percentile(boots, [2.5, 97.5])
    return point, lo, hi, len(b), len(a)


Z_ALPHA, Z_POWER = 1.96, 0.84                           # two-sided 5 % and 80 % power: the minimum detectable step is 2.8 standard errors
POOL = ("ukraine", "spain", "portugal", "greece", "italy")   # non-overlapping areas (iberia = spain + portugal is left out)


def detection_limit(lo: float, hi: float) -> float:
    """Smallest multiplicative step (> 1, either direction) that the test would detect with 80 % power, from a 95 % interval of the factor."""
    se = (np.log(hi) - np.log(lo)) / (2 * Z_ALPHA)
    return float(np.exp((Z_ALPHA + Z_POWER) * se))


def pooled_step(rs: dict[str, pd.Series], n_boot: int = 4000) -> tuple[float, float, float, int]:
    """Step of the average of the yearly medians of ln(ha / series) over the areas; year-block bootstrap (years resampled, areas averaged)."""
    ys = pd.DataFrame({a: yearly_median(r, 2006, 2018) for a, r in rs.items()})
    pooled = ys.mean(axis=1, skipna=True).dropna()
    b, a = pooled[(pooled.index >= BEFORE[0]) & (pooled.index <= BEFORE[1])], pooled[(pooled.index >= AFTER[0]) & (pooled.index <= AFTER[1])]
    point = float(a.median() - b.median())
    boots = [np.median(rng.choice(a.values, len(a))) - np.median(rng.choice(b.values, len(b))) for _ in range(n_boot)]
    lo, hi = np.percentile(boots, [2.5, 97.5])
    return point, float(lo), float(hi), int(ys.notna().all(axis=1).sum())


def detection_report(t: pd.DataFrame, rs: dict[tuple[str, str], pd.Series]) -> None:
    print("\n=== Detection limit of the step test ===")
    print("Smallest step (as a factor, either direction) detectable with 80 % power at 5 % two-sided, from the width of the bootstrap interval:")
    lim = t.assign(limit=[detection_limit(lo, hi) for lo, hi in zip(t.ci_lo, t.ci_hi)]).pivot(index="area", columns="series", values="limit")
    print(lim.round(2).to_string())
    print("\nPooled over ukraine, spain, portugal, greece, italy (mean of yearly medians; factor, 95 % interval, detection limit, years):")
    for name in SCALED:
        p, lo, hi, ny = pooled_step({a: rs[(a, name)] for a in POOL if (a, name) in rs})
        print(f"  {name:11s} {np.exp(p):.2f} ({np.exp(lo):.2f}..{np.exp(hi):.2f})  detectable step x{detection_limit(np.exp(lo), np.exp(hi)):.2f}  years {ny}")


def main() -> int:
    ha = monthly_ha()
    print("monthly burned area, total ha per year (rounded):")
    print(ha.groupby(ha.index.year).sum().round(-2).loc[[2003, 2008, 2012, 2017, 2022]].astype(int).to_string())
    rows, rho = [], []
    residuals: dict[tuple[str, str], pd.Series] = {}
    for area in config.AREAS:
        s = series(area)
        for name in SCALED:
            thr = MIN_SERIES if name != "frp_naive" else MIN_SERIES * 10
            ok = (s[name] >= thr) & (ha[area].reindex(s.index) >= MIN_HA)
            r = np.log(ha[area].reindex(s.index)[ok] / s[name][ok])
            residuals[(area, name)] = r
            p, lo, hi, nb, na = step(r)
            rows.append({"area": area, "series": name, "step_ln": p, "factor": np.exp(p), "ci_lo": np.exp(lo), "ci_hi": np.exp(hi),
                         "years_before": nb, "years_after": na, "months": int(ok.sum())})
            for lab, (y0, y1) in (("2003-2011", (2003, 2011)), ("2013-2024", (2013, 2024))):
                sel = (s.index.year >= y0) & (s.index.year <= y1) & (s[name] > 0)
                rho.append({"area": area, "series": name, "period": lab, "spearman": s[name][sel].corr(ha[area].reindex(s.index)[sel], method="spearman")})
    t = pd.DataFrame(rows)
    print("\nStep in ln(ha / series) between 2006-2011 and 2013-2018 as a factor (1 = no step; naive stitching expected 0.3-0.4):")
    print(t.pivot(index="area", columns="series", values="factor").round(2).to_string())
    print("\n95 % year-block bootstrap interval of the factor:")
    print(t.assign(ci=lambda x: x.ci_lo.round(2).astype(str) + " .. " + x.ci_hi.round(2).astype(str)).pivot(index="area", columns="series", values="ci").to_string())
    print("\nYears used (before/after) and months:", t.groupby("series")[["years_before", "years_after", "months"]].median().to_dict("index"))
    r = pd.DataFrame(rho)
    print("\nMonthly Spearman with burned area, before and after:")
    print(r.pivot_table(index=["area", "series"], columns="period", values="spearman").round(2).to_string())
    detection_report(t, residuals)
    return 0


if __name__ == "__main__":
    sys.exit(main())
