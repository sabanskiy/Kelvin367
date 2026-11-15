
import numpy as np
import pandas as pd
import pytest

from kelvin367_harmonization.weekly import chain


def make_table(n=200, ks=None, seed=0):
    """Weekly table with platforms A,B,C where B = kAB * A and C = kBC * B (day/night separately)."""
    rng = np.random.default_rng(seed)
    ks = ks or {"AB": (2.0, 0.5), "BC": (0.5, 2.0)}
    idx = pd.date_range("2015-01-05", periods=n, freq="7D")
    base = rng.lognormal(4.5, 0.8, n)
    a_d, a_n = rng.poisson(base * 0.7), rng.poisson(base * 0.3)
    b_d, b_n = rng.poisson(a_d * ks["AB"][0]), rng.poisson(a_n * ks["AB"][1])
    c_d, c_n = rng.poisson(b_d * ks["BC"][0]), rng.poisson(b_n * ks["BC"][1])
    cols = pd.MultiIndex.from_product([["A", "B", "C"], ["D", "N"]])
    return pd.DataFrame(np.column_stack([a_d, a_n, b_d, b_n, c_d, c_n]), index=idx, columns=cols)


def test_estimate_link_recovers_k_and_sigma_is_sensible():
    w = make_table()
    lk = chain.estimate_link(w, "A", "B")
    assert abs(lk.k_day - 2.0) < 0.1 and abs(lk.k_night - 0.5) < 0.05
    assert all(0.0 < s < 0.5 for s in lk.sigma) and lk.n_weeks > 100


def test_chain_composition_inverse_and_path():
    w = make_table()
    ch = chain.Chain().add(chain.estimate_link(w, "A", "B")).add(chain.estimate_link(w, "B", "C"))
    assert [(l.source, l.target) for l in ch.path("A", "C")] == [("A", "B"), ("B", "C")]
    d, n = w[("A", "D")], w[("A", "N")]
    pred, sig = ch.convert(d, n, "A", "C")
    direct = ch.path("A", "B")[0], ch.path("B", "C")[0]
    expect = direct[1].k_day * direct[0].k_day * d + direct[1].k_night * direct[0].k_night * n
    assert np.allclose(pred, expect)
    assert (sig > 0).all()
    back, _ = ch.convert(pred * 0 + 100.0, pred * 0, "C", "A")  # inverse path exists
    assert np.isfinite(back).all()
    with pytest.raises(KeyError):
        ch.path("A", "Z")


def test_sigma_adds_in_quadrature():
    l1 = chain.Link("A", "B", 1.0, 1.0, (0.1, 0.1, 0.1), 0.0)
    l2 = chain.Link("B", "C", 1.0, 1.0, (0.2, 0.2, 0.2), 0.05)
    ch = chain.Chain().add(l1).add(l2)
    idx = pd.date_range("2020-01-06", periods=3, freq="7D")
    _, s = ch.convert(pd.Series([50, 50, 50], idx), pd.Series([10, 10, 10], idx), "A", "C")
    assert np.allclose(s, np.sqrt(0.1 ** 2 + 0.2 ** 2 + 0.05 ** 2))


def test_valid_mask_respects_operating_dates_and_known_gaps():
    weeks = pd.DatetimeIndex(["2022-07-25", "2022-08-15", "2026-10-26", "2026-11-02"])
    v = chain.valid_mask(weeks, ["SNPP", "NOAA20", "MODIS"])
    assert not v.loc["2022-07-25", "SNPP"] and v.loc["2022-08-15", "SNPP"]   # 2022-07-27..08-10 gap
    assert bool(v.loc["2026-10-26", "SNPP"])  # this week ends on 2026-11-01, the day before delivery ceased (2026-11-02 13:00 UTC)
    assert not v.loc["2026-11-02", "SNPP"] and v.loc["2026-11-02", "NOAA20"]
    assert v["MODIS"].all()


def test_harmonize_uses_target_when_valid_and_fills_from_others():
    w = make_table()
    ch = chain.Chain().add(chain.estimate_link(w, "A", "B")).add(chain.estimate_link(w, "B", "C"))
    valid = pd.DataFrame(True, index=w.index, columns=["A", "B", "C"])
    valid.loc[w.index[:8], "C"] = False          # target missing in the first 8 weeks
    valid.loc[w.index[:5], "A"] = False          # weeks 0-4: only B is left
    valid.loc[w.index[5:8], "B"] = False         # weeks 5-7: only A is left
    out = chain.harmonize(w, ch, valid, target="C")
    assert out.loc[w.index[10], "sources"] == "C" and out.loc[w.index[10], "sigma"] == 0
    assert out.loc[w.index[2], "sources"] == "B" and out.loc[w.index[2], "sigma"] > 0
    assert out.loc[w.index[6], "sources"] == "A"
    assert out.loc[w.index[6], "sigma"] > out.loc[w.index[2], "sigma"]  # two links are less certain than one
    assert (out["lo"] <= out["est"]).all() and (out["est"] <= out["hi"]).all()
    # nothing valid -> NaN
    valid.loc[w.index[3], ["A", "B", "C"]] = False
    assert np.isnan(chain.harmonize(w, ch, valid, target="C").loc[w.index[3], "est"])


def test_weekly_platform_table_groups_terra_and_aqua():
    t = pd.to_datetime(["2020-01-06 10:00", "2020-01-07 22:00", "2020-01-08 01:00"], utc=True)
    df = pd.DataFrame({"time_utc": t, "platform": ["Terra", "Aqua", "SNPP"], "daynight": ["D", "N", "N"]})
    w = chain.weekly_platform_table(df)
    assert w[("MODIS", "D")].iloc[0] == 1 and w[("MODIS", "N")].iloc[0] == 1 and w[("SNPP", "N")].iloc[0] == 1


def test_geometric_estimator_is_unbiased_for_typical_weeks_when_ratio_varies_with_size():
    """When busy weeks have a lower ratio, the ratio of sums is pulled down by them; the geometric mean is not."""
    rng = np.random.default_rng(1)
    n = 400
    idx = pd.date_range("2015-01-05", periods=n, freq="7D")
    s = rng.lognormal(4, 1.2, n)
    k_true = 0.4 * (s / np.median(s)) ** -0.15       # ratio shrinks for big weeks
    t = rng.poisson(s * k_true)
    cols = pd.MultiIndex.from_product([["A", "B"], ["D", "N"]])
    w = pd.DataFrame(np.column_stack([rng.poisson(s), rng.poisson(s * 0.3), t, rng.poisson(s * k_true * 0.3)]), index=idx, columns=cols)
    typical = float(np.median(k_true))
    g = chain.estimate_link(w, "A", "B", estimator="geometric")
    sums = chain.estimate_link(w, "A", "B", estimator="sums")
    assert abs(g.k_day - typical) < abs(sums.k_day - typical)
    with pytest.raises(ValueError):
        chain.estimate_link(w, "A", "B", estimator="mean")
