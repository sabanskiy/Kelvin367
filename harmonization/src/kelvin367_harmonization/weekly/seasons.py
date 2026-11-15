"""Critical periods of a weekly burning record.

Definitions (all on the weekly series of one area; "week of year" is calendar.week_of_year, 0..51):

* Normal season windows: the climatological mean profile (mean over years by week of year, smoothed over 3 weeks, circular) is cut into
  runs of weeks above `thr` (20%) of its maximum; runs closer than `merge_gap` weeks are joined and runs shorter than `min_len` are
  dropped. One window for a Mediterranean summer season, two for a bimodal record such as Ukraine (spring and summer-autumn burning).
  Weeks are counted from the climatological minimum (`start_week`), so a season never straddles the start of the counting year.
* Counting year: 52 weeks counted from `start_week`, labelled by the calendar year in which its middle falls.
* Season of a year and window: the weeks of that counting year inside the window (extended by `margin` weeks on both sides);
  onset = first week and end = last week whose 3-week mean is at least `level` (the same absolute level, `thr` x the maximum of
  the smoothed climatological profile, that defines the windows), length = end - onset + 1 weeks, peak = the highest 3-week mean.
  A season needs at least 90% valid weeks and at least one week at the level. (A share-of-total definition was rejected: one
  huge episode makes the season "start late" because the earlier detections are a small share of that year's total.)
* Shift: onset / end / peak of a year minus the median of the baseline years, in weeks; trend = Theil-Sen slope (weeks per decade)
  with a Mann-Kendall p-value over the years.
* Critical episodes: runs of at least `min_weeks` consecutive weeks whose percentile (calendar.stratified_percentile, own year left
  out) is >= `threshold`, runs separated by at most `max_gap` weeks are joined. Each gets its dates, peak percentile, total detections,
  the total expected for the same weeks (median of the same week of year over all years) and the ratio.

The same algorithm is implemented in app/chain.js; tests/test_seasons.py and tests/test_seasons_js.py keep them identical.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .calendar import week_of_year

WEEKS = 52


def climatology(values: pd.Series, years=None) -> np.ndarray:
    """Mean weekly value by week of year (0..51) over `years` (default all); NaN weeks ignored."""
    idx = values.index
    woy = week_of_year(idx)
    ok = ~np.isnan(values.to_numpy(dtype=float))
    if years is not None:
        ok &= np.isin(idx.year, list(years))
    v = values.to_numpy(dtype=float)
    out = np.zeros(WEEKS)
    for w in range(WEEKS):
        m = ok & (woy == w)
        out[w] = v[m].mean() if m.any() else 0.0
    return out


def season_windows(profile: np.ndarray, thr: float = 0.2, min_len: int = 4, merge_gap: int = 3, smooth: bool = True):
    """Return (start_week, windows): start_week is the week of year of the smoothed minimum; windows are (a, b) inclusive positions
    counted from start_week (0..51)."""
    p = np.asarray(profile, dtype=float)
    sm = np.convolve(np.r_[p[-1], p, p[0]], np.ones(3) / 3, mode="valid") if smooth else p.copy()
    r = int(np.argmin(sm))
    rot = np.roll(sm, -r)
    if rot.max() <= 0:
        return r, []
    on = rot >= thr * rot.max()
    runs, s = [], None
    for i in range(WEEKS):
        if on[i] and s is None:
            s = i
        if s is not None and (not on[i] or i == WEEKS - 1):
            runs.append([s, i if on[i] else i - 1]); s = None
    merged = []
    for a, b in runs:
        if merged and a - merged[-1][1] - 1 <= merge_gap:
            merged[-1][1] = b
        else:
            merged.append([a, b])
    return r, [(a, b) for a, b in merged if b - a + 1 >= min_len]


def _positions(idx: pd.DatetimeIndex, start_week: int):
    woy = week_of_year(idx)
    pos = (woy - start_week) % WEEKS
    block_start_year = np.where(woy >= start_week, idx.year, idx.year - 1)
    # label = calendar year in which the middle of the counting year falls (so a season that sits in the following calendar year
    # of a block starting in late December is labelled by the year it belongs to)
    label = block_start_year + (1 if start_week + WEEKS // 2 >= WEEKS else 0)
    return pos, label


def season_level(profile: np.ndarray, thr: float = 0.2) -> float:
    """The activity level that defines the windows: thr x the maximum of the 3-week circular smoothed climatological profile."""
    p = np.asarray(profile, dtype=float)
    return float(thr * np.convolve(np.r_[p[-1], p, p[0]], np.ones(3) / 3, mode="valid").max())


def season_table(values: pd.Series, start_week: int, windows, level: float, margin: int = 3, min_valid: float = 0.9) -> pd.DataFrame:
    """One row per (counting year, window): total, onset, end, length (weeks), peak position/value, and the dates."""
    idx = values.index
    v = values.to_numpy(dtype=float)
    pos, label = _positions(idx, start_week)
    rows = []
    for wi, (a, b) in enumerate(windows):
        lo, hi = max(0, a - margin), min(WEEKS - 1, b + margin)
        for y in np.unique(label):
            m = (label == y) & (pos >= lo) & (pos <= hi)
            n = int(m.sum())
            if n < (hi - lo + 1) * min_valid or np.isnan(v[m]).sum() > n * (1 - min_valid):
                continue
            order = np.argsort(pos[m], kind="stable")
            vv = np.nan_to_num(v[m][order]); pp = pos[m][order]; ii = np.where(m)[0][order]
            tot = float(vv.sum())
            if tot <= 0:
                continue
            sm3 = np.convolve(np.r_[vv[0], vv, vv[-1]], np.ones(3) / 3, mode="valid")
            above = np.where(sm3 >= level)[0]
            if len(above) == 0:
                continue
            k_on, k_en = int(above[0]), int(above[-1])
            k_pk = int(np.argmax(sm3))
            rows.append({"window": wi, "year": int(y), "total": tot, "onset_pos": int(pp[k_on]), "end_pos": int(pp[k_en]),
                         "length": int(pp[k_en] - pp[k_on] + 1), "peak_pos": int(pp[k_pk]), "peak_value": float(sm3[k_pk]),
                         "onset_date": idx[ii[k_on]], "end_date": idx[ii[k_en]] + pd.Timedelta(days=6), "peak_date": idx[ii[k_pk]]})
    return pd.DataFrame(rows)


def season_normal(table: pd.DataFrame, baseline_years) -> pd.DataFrame:
    """Median onset / end / peak position, length and total per window over the baseline years."""
    t = table[table.year.isin(list(baseline_years))]
    if t.empty:
        return pd.DataFrame()
    return t.groupby("window").agg(onset_pos=("onset_pos", "median"), end_pos=("end_pos", "median"), peak_pos=("peak_pos", "median"),
                                    length=("length", "median"), total=("total", "median"), peak_value=("peak_value", "median"), years=("year", "size")).reset_index()


def theil_sen(x, y):
    """Theil-Sen slope and Mann-Kendall two-sided p-value (normal approximation, no tie correction beyond variance)."""
    x, y = np.asarray(x, dtype=float), np.asarray(y, dtype=float)
    n = len(x)
    if n < 6:
        return float("nan"), float("nan")
    sl = [(y[j] - y[i]) / (x[j] - x[i]) for i in range(n) for j in range(i + 1, n) if x[j] != x[i]]
    slope = float(np.median(sl))
    s = sum(np.sign(y[j] - y[i]) for i in range(n) for j in range(i + 1, n))
    var = n * (n - 1) * (2 * n + 5) / 18.0
    z = (s - np.sign(s)) / np.sqrt(var) if s != 0 else 0.0
    from math import erf, sqrt
    p = 2 * (1 - 0.5 * (1 + erf(abs(z) / sqrt(2))))
    return slope, float(p)


def critical_episodes(pct: pd.Series, values: pd.Series, threshold: float = 90.0, min_weeks: int = 2, max_gap: int = 1) -> pd.DataFrame:
    """Runs of weeks with percentile >= threshold (see module docstring), ranked by the excess over the expected total."""
    idx = values.index
    p = pct.to_numpy(dtype=float)
    v = np.nan_to_num(values.to_numpy(dtype=float))
    flag = np.nan_to_num(p, nan=-1.0) >= threshold
    woy = week_of_year(idx)
    med = np.array([np.median(v[(woy == w) & ~np.isnan(values.to_numpy(dtype=float))]) if ((woy == w) & ~np.isnan(values.to_numpy(dtype=float))).any() else 0.0 for w in range(WEEKS)])
    runs, i, n = [], 0, len(flag)
    while i < n:
        if not flag[i]:
            i += 1
            continue
        j = i
        while True:
            k = next((j + t for t in range(1, max_gap + 2) if j + t < n and flag[j + t]), None)   # next flagged week within max_gap unflagged ones
            if k is None:
                break
            j = k
        runs.append((i, j)); i = j + 1
    rows = []
    for a, b in runs:
        if b - a + 1 < min_weeks:
            continue
        tot = float(v[a:b + 1].sum()); exp = float(med[woy[a:b + 1]].sum())
        year = idx[a].year
        ym = (idx.year == year)
        rows.append({"start": idx[a], "end": idx[b] + pd.Timedelta(days=6), "weeks": b - a + 1, "peak_pct": float(np.nanmax(p[a:b + 1])),
                     "peak_date": idx[a + int(np.argmax(v[a:b + 1]))], "total": tot, "expected": exp, "ratio": tot / exp if exp > 0 else float("nan"),
                     "share_of_year": float(tot / v[ym].sum()) if v[ym].sum() > 0 else float("nan")})
    out = pd.DataFrame(rows)
    if not out.empty:
        out["excess"] = out.total - out.expected
        out = out.sort_values("excess", ascending=False, kind="mergesort").reset_index(drop=True)
    return out
