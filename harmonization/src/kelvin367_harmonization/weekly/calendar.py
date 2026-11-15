"""Building blocks for the burning-activity calendar: week-of-year percentiles and the naive sensor stitch."""
from __future__ import annotations

import numpy as np
import pandas as pd

from .config import NAIVE_CUTOFF


def week_of_year(index: pd.DatetimeIndex) -> np.ndarray:
    """0..51 position of the week inside the year (days since 1 Jan // 7, capped at 51)."""
    return np.minimum((index.dayofyear.to_numpy() - 1) // 7, 51)


def seasonal_percentile(values: pd.Series, baseline_years, window: int = 1) -> pd.Series:
    """Percentile (0-100) of every week against the same week of the year (+- `window` weeks) in the baseline years.

    The comparison sample contains the baseline years only, so a week inside the baseline is also compared with its own
    year; with 15+ baseline years the effect is small. Ties count half. NaN stays NaN.
    """
    idx = values.index
    woy = week_of_year(idx)
    base = np.isin(idx.year, list(baseline_years))
    v = values.to_numpy(dtype=float)
    out = np.full(len(v), np.nan)
    for i in range(len(v)):
        if np.isnan(v[i]):
            continue
        d = np.abs(woy - woy[i])
        near = base & (np.minimum(d, 52 - d) <= window) & ~np.isnan(v)
        sample = v[near]
        if len(sample) < 5:
            continue
        out[i] = 100.0 * ((sample < v[i]).sum() + 0.5 * (sample == v[i]).sum()) / len(sample)
    return pd.Series(out, index=idx)


def naive_stitch(modis_total: pd.Series, viirs_total: pd.Series, switch: str = NAIVE_CUTOFF) -> pd.Series:
    """What a user gets by gluing raw sensor counts: MODIS before `switch`, raw VIIRS from it onwards."""
    sw = pd.Timestamp(switch)
    return pd.Series(np.where(modis_total.index < sw, modis_total.to_numpy(dtype=float), viirs_total.to_numpy(dtype=float)),
                     index=modis_total.index)


def stratified_percentile(values: pd.Series, base_values: pd.Series, split_year: int, mode: str,
                          window: int = 1, min_sample: int = 5, target_sample: int = 12, max_window: int = 4) -> pd.Series:
    """Percentile of each week against baseline weeks of the same season, leaving out the week's own year.

    mode="pre":  baseline = weeks of years before `split_year` only.
    mode="same": baseline = weeks of the same regime as the week itself (before / from `split_year`).
    `base_values` is the series that supplies the baseline (the harmonized series); `values` is what is ranked.
    The seasonal window starts at +-`window` weeks and widens (up to `max_window`) until the baseline holds at least
    `target_sample` weeks, because a handful of weeks makes percentiles coarse (with 6 weeks about 29% of ordinary weeks
    would rank below 10 or above 90 by chance). Weeks with fewer than `min_sample` baseline weeks get NaN.
    """
    if mode not in ("pre", "same"):
        raise ValueError("mode must be 'pre' or 'same'")
    idx = values.index
    woy = week_of_year(idx)
    yr = idx.year.to_numpy()
    v = values.to_numpy(dtype=float)
    b = base_values.to_numpy(dtype=float)
    out = np.full(len(v), np.nan)
    for i in range(len(v)):
        if np.isnan(v[i]):
            continue
        d = np.minimum(np.abs(woy - woy[i]), 52 - np.abs(woy - woy[i]))
        regime = (yr < split_year) if (mode == "pre" or yr[i] < split_year) else (yr >= split_year)
        ok = regime & (yr != yr[i]) & ~np.isnan(b)
        sample = b[ok & (d <= window)]
        w = window
        while len(sample) < target_sample and w < max_window:
            w += 1
            sample = b[ok & (d <= w)]
        if len(sample) < min_sample:
            continue
        out[i] = 100.0 * ((sample < v[i]).sum() + 0.5 * (sample == v[i]).sum()) / len(sample)
    return pd.Series(out, index=idx)


def regime_effects(values: pd.Series, split_year: int, window: int = 1, min_weeks: int = 20, min_sample: int = 5) -> dict:
    """Level change after `split_year` relative to the typical level of the same weeks before it.

    Each week is compared with the median of the same season (+- `window` weeks) in the pre-split years other than its own
    year (log of (value + 1) ratios). The yearly mean of these deviations is the year effect. `sd_pre` is the standard
    deviation of the pre-split year effects, i.e. how much a normal year differs from the norm; z = effect / sd_pre.
    """
    idx = values.index
    woy = week_of_year(idx)
    yr = idx.year.to_numpy()
    v = values.to_numpy(dtype=float)
    z = np.full(len(v), np.nan)
    for i in range(len(v)):
        if np.isnan(v[i]):
            continue
        d = np.abs(woy - woy[i])
        near = (yr < split_year) & (yr != yr[i]) & (np.minimum(d, 52 - d) <= window) & ~np.isnan(v)
        if near.sum() < min_sample:
            continue
        z[i] = np.log((v[i] + 1.0) / (np.median(v[near]) + 1.0))
    g = pd.Series(z, index=idx).groupby(yr)
    mean, cnt = g.mean(), g.count()
    ok = cnt >= min_weeks
    pre = mean[ok & (mean.index < split_year)]
    sd = float(pre.std(ddof=1)) if len(pre) >= 3 else float("nan")
    rows = []
    for y in mean.index:
        if ok[y] and y >= split_year:
            rows.append({"year": int(y), "weeks": int(cnt[y]), "effect_pct": float((np.exp(mean[y]) - 1) * 100),
                         "z": float(mean[y] / sd) if sd == sd and sd > 0 else float("nan")})
    return {"split": int(split_year), "sd_pre": sd, "pre_years": int(len(pre)), "rows": rows}


def month_shares(values: pd.Series, split_year: int) -> dict:
    """Share (percent) of the annual total that falls in each calendar month, before and from `split_year`."""
    df = pd.DataFrame({"v": values.to_numpy(dtype=float), "y": values.index.year, "m": values.index.month}).dropna()
    out = {}
    for name, sel in (("pre", df.y < split_year), ("post", df.y >= split_year)):
        s = df[sel].groupby("m").v.sum().reindex(range(1, 13), fill_value=0.0)
        out[name] = [float(x) for x in (100 * s / s.sum() if s.sum() > 0 else s)]
    return out


def _share_vector(df: pd.DataFrame, years) -> np.ndarray:
    t = df[df.y.isin(list(years))].groupby("m").v.sum().reindex(range(1, 13), fill_value=0.0)
    return (t / t.sum()).to_numpy() if t.sum() > 0 else np.full(12, np.nan)


def season_shift_test(values: pd.Series, split_year: int, window_years: int = 3, min_weeks: int = 40,
                      min_windows: int = 6, min_pre_years: int = 15) -> dict | None:
    """Is the change of the seasonal profile after `split_year` larger than the usual change between multi-year windows?

    Distance = total variation between month-share profiles. The post-split years are compared with all pre-split years;
    the reference distribution is every run of `window_years` consecutive pre-split years compared with the other pre-split
    years. `rank_pct` is the share of those reference windows with a smaller distance (95+ means unusual).
    Returns None when there are too few years: fewer than `min_pre_years` (default 15) full years before the split, because on a
    10-year baseline the test also flags peaceful countries (Spain, Portugal, Italy).
    """
    df = pd.DataFrame({"v": values.to_numpy(dtype=float), "y": values.index.year, "m": values.index.month}).dropna()
    nweeks = df.groupby("y").size()
    years = [int(y) for y in nweeks.index if nweeks[y] >= min_weeks]
    pre_years = [y for y in years if y < split_year]
    post_years = [y for y in years if y >= split_year]
    if not post_years or len(pre_years) < max(window_years + 3, min_pre_years):
        return None
    tv = lambda p, q: 0.5 * float(np.abs(p - q).sum())
    d_pre = []
    for y0 in pre_years:
        w = list(range(y0, y0 + window_years))
        if all(y in pre_years for y in w):
            rest = [y for y in pre_years if y not in w]
            d_pre.append(tv(_share_vector(df, w), _share_vector(df, rest)))
    if len(d_pre) < min_windows:
        return None
    d_post = tv(_share_vector(df, post_years), _share_vector(df, pre_years))
    return {"post_distance": d_post, "pre_median": float(np.median(d_pre)), "pre_max": float(max(d_pre)),
            "rank_pct": 100.0 * float((np.array(d_pre) < d_post).mean()), "windows": len(d_pre), "post_years": post_years}
