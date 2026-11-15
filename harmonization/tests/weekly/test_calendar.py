import numpy as np
import pytest
import pandas as pd

from kelvin367_harmonization.weekly import calendar


def test_seasonal_percentile_ranks_against_same_season():
    idx = pd.date_range("2003-01-06", "2023-12-25", freq="7D")
    season = 50 + 40 * np.sin(2 * np.pi * (idx.dayofyear / 365))
    v = pd.Series(season, index=idx)
    spike = idx[(idx.year == 2022) & (idx.month == 7)][1]
    v[spike] = 1000
    p = calendar.seasonal_percentile(v, range(2003, 2022))
    assert p[spike] == 100.0
    typical = idx[(idx.year == 2010) & (idx.month == 3)][0]
    assert 5 < p[typical] < 95


def test_percentile_nan_and_short_sample():
    idx = pd.date_range("2020-01-06", periods=10, freq="7D")
    v = pd.Series(np.arange(10.0), index=idx)
    v.iloc[3] = np.nan
    p = calendar.seasonal_percentile(v, [2020])
    assert np.isnan(p.iloc[3])


def test_naive_stitch_switches_at_date():
    idx = pd.date_range("2011-12-12", periods=4, freq="7D")  # 12-12, 12-19, 12-26, 01-02
    m = pd.Series([1.0, 2, 3, 4], index=idx); v = pd.Series([10.0, 20, 30, 40], index=idx)
    s = calendar.naive_stitch(m, v, "2012-01-01")
    assert list(s) == [1, 2, 3, 40]


def _seasonal_series(years, level_after=1.0, shift_weeks=0, seed=0):
    rng = np.random.default_rng(seed)
    idx = pd.date_range(f"{years[0]}-01-02", f"{years[-1]}-12-25", freq="7D")
    base = 40 + 35 * np.sin(2 * np.pi * (idx.dayofyear - 60 - 7 * (shift_weeks * (idx.year >= 2022))) / 365)
    lvl = np.where(idx.year >= 2022, level_after, 1.0)
    return pd.Series(np.maximum(0, rng.poisson(np.maximum(base, 1) * lvl * rng.lognormal(0, 0.25, len(idx)))), index=idx, dtype=float)


def test_regime_effects_detect_level_shift_and_ignore_no_change():
    shifted = calendar.regime_effects(_seasonal_series(range(2003, 2025), level_after=2.0), 2022)
    flat = calendar.regime_effects(_seasonal_series(range(2003, 2025), level_after=1.0), 2022)
    assert [r["year"] for r in shifted["rows"]] == [2022, 2023, 2024] and shifted["pre_years"] == 19
    assert all(r["effect_pct"] > 60 and r["z"] > 2 for r in shifted["rows"])
    assert all(abs(r["z"]) < 2 for r in flat["rows"])


def test_stratified_percentile_removes_seasonal_regime_artifacts():
    s = _seasonal_series(range(2003, 2025), shift_weeks=8)   # the season moves 8 weeks later from 2022
    pre = calendar.stratified_percentile(s, s, 2022, "pre")
    same = calendar.stratified_percentile(s, s, 2022, "same")
    post = s.index.year >= 2022
    def extreme(p):
        x = p[post].dropna()
        return float(((x > 90) | (x < 10)).mean())
    # against the old norm many weeks look unusual; within the regime about as many as chance (nominal 20%)
    assert extreme(pre) > 0.35 and extreme(same) < 0.25 and extreme(pre) > extreme(same) + 0.15
    with pytest.raises(ValueError):
        calendar.stratified_percentile(s, s, 2022, "all")


def test_month_shares_sum_to_100():
    s = _seasonal_series(range(2010, 2025))
    sh = calendar.month_shares(s, 2022)
    assert abs(sum(sh["pre"]) - 100) < 1e-6 and abs(sum(sh["post"]) - 100) < 1e-6 and len(sh["pre"]) == 12


def test_season_shift_test_flags_a_seasonal_shift_and_not_noise():
    shifted = calendar.season_shift_test(_seasonal_series(range(2003, 2025), shift_weeks=10), 2022)
    flat = calendar.season_shift_test(_seasonal_series(range(2003, 2025), shift_weeks=0), 2022)
    assert shifted["rank_pct"] >= 95 and flat["rank_pct"] < 95
    assert shifted["post_years"] == [2022, 2023, 2024] and shifted["windows"] >= 6
    assert calendar.season_shift_test(_seasonal_series(range(2018, 2025)), 2022) is None   # too few pre-split years
    assert calendar.season_shift_test(_seasonal_series(range(2010, 2025), shift_weeks=10), 2022) is None   # 12 pre-split years < 15
    assert calendar.season_shift_test(_seasonal_series(range(2007, 2025), shift_weeks=10), 2022) is not None   # 15 pre-split years
