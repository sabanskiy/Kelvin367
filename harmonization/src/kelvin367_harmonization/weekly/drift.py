"""Drift of the MODIS/VIIRS ratio (Terra and Aqua orbit drift) as season-adjusted year effects.

`fit_year_effects` regresses log(num / den) of weekly counts on (AOI x month) season dummies and year dummies for the years
after the reference period, by weighted least squares (Poisson precision weights) with HC1 robust standard errors.
The year effect is the log change of the ratio relative to the reference years. `YearEffects.factor(year)` gives the
multiplicative change, so `actual / factor` restores the pre-drift scale and `sigma(year)` its standard error.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass
class YearEffects:
    table: pd.DataFrame  # columns: year, effect (log), se, weeks

    def factor(self, years) -> np.ndarray:
        t = self.table.set_index("year")["effect"]
        return np.exp(pd.Series(np.asarray(years)).map(t).fillna(0.0).to_numpy())

    def sigma(self, years) -> np.ndarray:
        t = self.table.set_index("year")["se"]
        return pd.Series(np.asarray(years)).map(t).fillna(0.0).to_numpy()

    def summary(self) -> pd.DataFrame:
        t = self.table.copy()
        t["change_pct"] = (np.exp(t.effect) - 1) * 100
        t["ci_lo_pct"] = (np.exp(t.effect - 1.96 * t.se) - 1) * 100
        t["ci_hi_pct"] = (np.exp(t.effect + 1.96 * t.se) - 1) * 100
        return t[["year", "weeks", "change_pct", "ci_lo_pct", "ci_hi_pct"]]


def panel_from_weekly(weekly: dict, valid: dict, num: str = "MODIS", den: str = "SNPP", dn=("D", "N")) -> pd.DataFrame:
    """Stack per-AOI weekly platform tables (chain.weekly_platform_table) into rows (aoi, week, num, den).

    `valid[aoi]` is a boolean Series over the weeks of that AOI (the denominator platform must be valid).
    """
    frames = []
    for a, w in weekly.items():
        ok = valid[a].reindex(w.index).to_numpy(dtype=bool)
        n = sum(w[(num, d)] for d in dn)
        m = sum(w[(den, d)] for d in dn)
        frames.append(pd.DataFrame({"aoi": a, "week": w.index[ok], "num": n.to_numpy()[ok], "den": m.to_numpy()[ok]}))
    return pd.concat(frames, ignore_index=True)


def fit_year_effects(panel: pd.DataFrame, ref_years, last_year: int, min_count: int = 10) -> YearEffects:
    p = panel[(panel.num >= min_count) & (panel.den >= min_count)].copy()
    p["y"] = np.log(p.num / p.den)
    p["w"] = 1.0 / (1.0 / p.num + 1.0 / p.den)
    p["year"] = p.week.dt.year
    p["season"] = p.aoi + "_" + p.week.dt.month.astype(str)
    ref = set(ref_years)
    years = [y for y in range(min(ref), last_year + 1) if y not in ref]
    S = pd.get_dummies(p.season).astype(float)
    Y = pd.DataFrame({f"y{y}": (p.year == y).astype(float) for y in years})
    X = pd.concat([S, Y], axis=1)
    sw = np.sqrt(p.w.to_numpy())
    Xw, yw = X.to_numpy() * sw[:, None], p.y.to_numpy() * sw
    beta, *_ = np.linalg.lstsq(Xw, yw, rcond=None)
    res = yw - Xw @ beta
    inv = np.linalg.pinv(Xw.T @ Xw)
    meat = (Xw * res[:, None]).T @ (Xw * res[:, None])
    n, k = Xw.shape
    cov = inv @ meat @ inv * n / max(n - k, 1)
    rows = []
    for j, y in enumerate(years):
        cnt = int(Y[f"y{y}"].sum())
        if cnt < 5:
            continue
        idx = S.shape[1] + j
        rows.append({"year": y, "effect": float(beta[idx]), "se": float(np.sqrt(cov[idx, idx])), "weeks": cnt})
    return YearEffects(pd.DataFrame(rows))
