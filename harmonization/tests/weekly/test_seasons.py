import numpy as np
import pandas as pd

from kelvin367_harmonization.weekly import calendar as cal
from kelvin367_harmonization.weekly import seasons


def synthetic(years=range(2003, 2025), onset=24, length=12, shift_per_year=0.0, peak=100.0, seed=0, extra=None):
    """Weekly series with one Gaussian-like season per year (onset week, length in weeks), optional drift of the onset."""
    idx = pd.date_range(f"{years[0]}-01-06", f"{years[-1]}-12-29", freq="W-MON")
    woy = cal.week_of_year(idx)
    rng = np.random.default_rng(seed)
    v = np.zeros(len(idx))
    for i, (d, w) in enumerate(zip(idx, woy)):
        o = onset + shift_per_year * (d.year - years[0])
        x = (w - (o + length / 2)) / (length / 3.0)
        v[i] = peak * np.exp(-0.5 * x * x) * (1 + 0.1 * rng.standard_normal()) + 0.5
    s = pd.Series(np.clip(v, 0, None), index=idx)
    for (a, b, f) in (extra or []):
        s[a:b] = s[a:b] * f
    return s


def test_one_window_recovers_season_onset_and_end():
    s = synthetic()
    prof = seasons.climatology(s)
    r, win = seasons.season_windows(prof)
    assert len(win) == 1
    tab = seasons.season_table(s, r, win, seasons.season_level(prof))
    norm = seasons.season_normal(tab, range(2003, 2025))
    onset_woy = (norm.onset_pos.iloc[0] + r) % 52
    end_woy = (norm.end_pos.iloc[0] + r) % 52
    assert abs(onset_woy - 23) <= 2 and abs(end_woy - 37) <= 2     # level crossings of a Gaussian season centred on week 30
    assert 11 <= norm.length.iloc[0] <= 17


def test_two_windows_for_bimodal_record_and_none_for_flat_noise():
    a, b = synthetic(onset=8, length=8), synthetic(onset=34, length=14)
    s = a + b
    r, win = seasons.season_windows(seasons.climatology(s))
    assert len(win) == 2
    flat = pd.Series(np.random.default_rng(1).uniform(5, 6, len(s)), index=s.index)
    r2, win2 = seasons.season_windows(seasons.climatology(flat), thr=0.9)
    assert len(win2) <= 1


def test_trend_of_a_drifting_onset_is_recovered():
    s = synthetic(shift_per_year=-0.3)          # onset moves 0.3 weeks earlier every year (3 weeks per decade)
    prof = seasons.climatology(s)
    r, win = seasons.season_windows(prof)
    tab = seasons.season_table(s, r, win, seasons.season_level(prof))
    slope, p = seasons.theil_sen(tab.year, tab.onset_pos)
    assert -0.45 < slope < -0.15 and p < 0.01
    flat = seasons.season_table(synthetic(seed=3), r, win, seasons.season_level(prof))
    sl2, p2 = seasons.theil_sen(flat.year, flat.onset_pos)
    assert abs(sl2) < 0.15 and p2 > 0.05


def test_one_huge_episode_does_not_make_the_season_start_late():
    base = synthetic()
    prof = seasons.climatology(base)
    r, win = seasons.season_windows(prof)
    level = seasons.season_level(prof)
    normal = seasons.season_table(base, r, win, level)
    spiked = base.copy()
    spiked["2015-08-03":"2015-08-24"] *= 40       # one huge late-summer burst in 2015
    tab = seasons.season_table(spiked, r, win, level)
    a = normal[normal.year == 2015].iloc[0]
    b = tab[tab.year == 2015].iloc[0]
    assert b.onset_pos <= a.onset_pos            # a cumulative-share definition would move the onset towards the burst
    assert b.peak_value > 5 * a.peak_value


def test_episodes_are_found_ranked_and_expected_is_computed():
    base = synthetic()
    s = base.copy()
    s["2012-07-02":"2012-07-23"] *= 6           # a four-week burst in 2012
    s["2018-06-04":"2018-06-04"] *= 8           # a single-week spike: must not become an episode (min_weeks=2)
    pct = cal.stratified_percentile(s, s, 9999, "pre")
    ep = seasons.critical_episodes(pct, s)
    assert len(ep) >= 1
    top = ep.iloc[0]
    assert pd.Timestamp("2012-06-25") <= top.start <= pd.Timestamp("2012-07-09") and top.weeks >= 2
    assert top.ratio > 2 and top.peak_pct >= 95
    assert not ((ep.start <= pd.Timestamp("2018-06-04")) & (ep.end >= pd.Timestamp("2018-06-04")) & (ep.weeks == 1)).any()
