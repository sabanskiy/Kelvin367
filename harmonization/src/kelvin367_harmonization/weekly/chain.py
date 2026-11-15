"""Calibration chain between fire-detecting platforms, with uncertainty propagation and gap filling.

Platform groups used here: "MODIS" (Terra + Aqua combined), "SNPP", "NOAA20", "NOAA21".

A `Link` says how many `target` records you expect per `source` record, separately for day and night, with a random
(weekly) log-uncertainty by magnitude and an optional systematic log-uncertainty (variability of k between quarters).
A `Chain` joins links into a graph; `convert` follows the shortest path and adds the variances of the links.
`harmonize` builds one weekly series on the scale of a chosen target platform (default MODIS-equivalent) from whichever
platforms are valid in each week (outside known gaps and inside their operating dates).

Limits worth knowing:
- Uncertainty is log-normal and links are assumed independent; averaging platforms does not shrink the uncertainty.
- Estimates with a count of zero stay zero (the interval collapses); small counts are poorly described.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from datetime import date, timedelta

import numpy as np
import pandas as pd

from . import sensors

GROUP = {"Terra": "MODIS", "Aqua": "MODIS", "SNPP": "SNPP", "NOAA20": "NOAA20", "NOAA21": "NOAA21"}
BIN_EDGES = (30.0, 100.0)  # inner edges of the magnitude bins of the predicted target counts
Z80 = 1.2816               # two-sided 80% interval for a normal distribution
# the model sigma is somewhat conservative (nominal 80% intervals covered 88% of held-out weeks). The interval half-width is
# z = Z80 * INTERVAL_SCALE; the scale was chosen on 2020-2021 residuals of S-NPP -> MODIS (links trained 2012-2019, ten areas) and gave
# 0.78 coverage on 2022 onward (0.66-0.89 by area). The same constant is in app/chain.js.
INTERVAL_SCALE = 0.78
INTERVAL_Z = Z80 * INTERVAL_SCALE
MODIS_TWO_SATELLITE_START = date(2003, 1, 1)  # Terra-only before mid-2002


def weekly_platform_table(df: pd.DataFrame, start: str | None = None, end: str | None = None,
                          split_modis: bool = False) -> pd.DataFrame:
    """Weekly counts with MultiIndex columns (group, 'D'|'N'). `df` needs time_utc, platform, daynight.

    With split_modis=True Terra and Aqua keep their own columns instead of being summed into "MODIS".
    """
    t = df["time_utc"]
    naive = t.dt.tz_localize(None) if t.dt.tz is not None else t
    g = pd.DataFrame({
        "week": naive.dt.to_period("W-SUN").dt.start_time.values,
        "grp": (df["platform"] if split_modis else df["platform"].map(GROUP)).values,
        "dn": df["daynight"].values,
    }).dropna().groupby(["week", "grp", "dn"]).size().unstack(["grp", "dn"], fill_value=0)
    lo = pd.Timestamp(start) if start else g.index.min()
    hi = pd.Timestamp(end) if end else g.index.max()
    return g.reindex(pd.date_range(lo, hi, freq="7D"), fill_value=0)


@dataclass(frozen=True)
class Link:
    source: str
    target: str
    k_day: float
    k_night: float
    sigma: tuple[float, float, float]  # random weekly log-sd, by magnitude bin of predicted target counts
    sigma_sys: float = 0.0             # log-sd of k between quarters (systematic part)
    n_weeks: int = 0

    def inverse(self) -> "Link":
        return Link(self.target, self.source, 1.0 / self.k_day, 1.0 / self.k_night, self.sigma, self.sigma_sys, self.n_weeks)

    def sigma_at(self, pred) -> np.ndarray:
        idx = np.digitize(np.asarray(pred, dtype=float), BIN_EDGES)
        return np.asarray(self.sigma)[idx]


def _robust_sd(r: np.ndarray) -> float:
    return float(1.4826 * np.median(np.abs(r - np.median(r))))


def estimate_link(w: pd.DataFrame, source: str, target: str, train: tuple[str, str] | None = None,
                  min_count: int = 3, estimator: str = "geometric") -> Link:
    """Estimate k (target per source records, day/night) and uncertainty from a weekly platform table.

    estimator="geometric" (default): exp(mean(log(target / source))) over weeks, i.e. the typical weekly ratio. It is
    right for weekly values. estimator="sums": sum(target) / sum(source), dominated by the busiest weeks; right for
    totals but biased for typical weeks.
    """
    if estimator not in ("geometric", "sums"):
        raise ValueError("estimator must be 'geometric' or 'sums'")
    x = w if train is None else w.loc[train[0]:train[1]]
    k = {}
    for dn in ("D", "N"):
        s, t = x[(source, dn)], x[(target, dn)]
        ok = (s >= min_count) & (t >= min_count)
        if not ok.any():
            raise ValueError(f"no weeks with both {source} and {target} >= {min_count} ({dn})")
        k[dn] = float(t[ok].sum() / s[ok].sum()) if estimator == "sums" else float(np.exp(np.log(t[ok] / s[ok]).mean()))
    pred = k["D"] * x[(source, "D")] + k["N"] * x[(source, "N")]
    act = x[(target, "D")] + x[(target, "N")]
    ok = (pred >= 3) & (act >= 3)
    r = np.log(act[ok] / pred[ok]).to_numpy()
    if len(r) < 10:
        raise ValueError("too few weeks to estimate the link uncertainty")
    overall = _robust_sd(r)
    b = np.digitize(pred[ok].to_numpy(), BIN_EDGES)
    sig = tuple(_robust_sd(r[b == i]) if (b == i).sum() >= 20 else overall for i in range(3))
    # systematic part: variability of k between quarters
    q = pd.PeriodIndex(x.index, freq="Q")
    logs = []
    for dn in ("D", "N"):
        ks = []
        for _, g in x.groupby(q):
            s, t = g[(source, dn)], g[(target, dn)]
            ok2 = (s >= min_count) & (t >= min_count)
            if ok2.sum() >= 4 and s[ok2].sum() > 0:
                ks.append(np.log(t[ok2].sum() / s[ok2].sum()) if estimator == "sums" else float(np.log(t[ok2] / s[ok2]).mean()))
        if len(ks) >= 4:
            logs.append(np.var(ks, ddof=1))
    sys_sd = float(np.sqrt(np.mean(logs))) if logs else 0.0
    return Link(source, target, k["D"], k["N"], sig, sys_sd, int(ok.sum()))


@dataclass
class Chain:
    links: dict = field(default_factory=dict)

    def add(self, link: Link) -> "Chain":
        self.links[(link.source, link.target)] = link
        self.links[(link.target, link.source)] = link.inverse()
        return self

    def path(self, src: str, dst: str) -> list[Link]:
        if src == dst:
            return []
        prev = {src: None}
        queue = deque([src])
        while queue:
            cur = queue.popleft()
            for (a, b), link in self.links.items():
                if a == cur and b not in prev:
                    prev[b] = (cur, link)
                    queue.append(b)
        if dst not in prev:
            raise KeyError(f"no path {src} -> {dst}")
        out, node = [], dst
        while prev[node] is not None:
            node, link = prev[node]
            out.append(link)
        return out[::-1]

    def convert(self, d: pd.Series, n: pd.Series, src: str, dst: str) -> tuple[pd.Series, pd.Series]:
        """Weekly day/night counts on `src` -> total counts on `dst` and the log-sd of the conversion."""
        d, n = d.astype(float), n.astype(float)
        var = pd.Series(0.0, index=d.index)
        links = self.path(src, dst)
        if not links:
            return d + n, var
        pred = d + n
        for link in links:
            d, n = link.k_day * d, link.k_night * n
            pred = d + n
            var = var + link.sigma_at(pred) ** 2 + link.sigma_sys ** 2
        return pred, np.sqrt(var)


def valid_mask(weeks: pd.DatetimeIndex, platforms, gaps=None) -> pd.DataFrame:
    """True where a platform can be used in a week: operating for the whole week and without a known gap day."""
    gaps = sensors.KNOWN_GAPS if gaps is None else gaps
    out = pd.DataFrame(True, index=weeks, columns=list(platforms))
    for p in platforms:
        if p == "MODIS":
            start, end = MODIS_TWO_SATELLITE_START, None
            pgaps = [g for g in gaps if g.platform == "MODIS"]  # e.g. weeks for which no MODIS data were downloaded
        else:
            pl = sensors.PLATFORMS[p]
            start, end = pl.start, pl.end
            pgaps = [g for g in gaps if g.platform == p]
        for w in weeks:
            d0, d1 = w.date(), (w + timedelta(days=6)).date()
            ok = d0 >= start and (end is None or d1 <= end)
            ok = ok and not any(g.start <= d1 and g.end >= d0 for g in pgaps)
            out.loc[w, p] = bool(ok)
    return out


def harmonize(w: pd.DataFrame, chain: Chain, valid: pd.DataFrame | None = None, target: str = "MODIS",
              z: float | None = None, target_factor: pd.Series | None = None, target_sigma: pd.Series | None = None) -> pd.DataFrame:
    """One weekly series on the scale of `target`.

    Rule per week: if `target` itself is valid, use it (no uncertainty). Otherwise convert every valid platform through
    the chain and combine them with inverse-variance weights; the reported log-sd is the smallest among the platforms
    used (averaging nearly identical platforms is not allowed to claim extra precision).
    Optional `target_factor` (indexed like `w`) divides the actual target counts to restore a reference scale (for example
    the pre-drift MODIS scale, see drift.py); `target_sigma` is then the log-uncertainty of that correction.
    Columns: est, lo, hi (central interval with half-width z * sigma; default z = INTERVAL_Z, the calibrated 80% interval), sigma, sources.
    """
    z = INTERVAL_Z if z is None else z
    platforms = sorted({c[0] for c in w.columns})
    valid = valid_mask(w.index, platforms) if valid is None else valid
    ests, sigs = {}, {}
    for p in platforms:
        d, n = w[(p, "D")], w[(p, "N")]
        if p == target:
            ests[p], sigs[p] = d + n, pd.Series(0.0, index=w.index)
        else:
            try:
                ests[p], sigs[p] = chain.convert(d, n, p, target)
            except KeyError:
                continue
    out = pd.DataFrame(index=w.index, columns=["est", "lo", "hi", "sigma", "sources"], dtype=object)
    for wk in w.index:
        if target in ests and bool(valid.loc[wk, target]):
            f = 1.0 if target_factor is None else float(target_factor.loc[wk])
            e = float(ests[target][wk]) / f
            s = 0.0 if target_sigma is None else float(target_sigma.loc[wk])
            src = target
        else:
            use = [p for p in ests if p != target and bool(valid.loc[wk, p])]
            if not use:
                out.loc[wk] = [np.nan, np.nan, np.nan, np.nan, ""]
                continue
            wt = np.array([1.0 / (float(sigs[p][wk]) ** 2 + 1e-9) for p in use])
            e = float(np.average([float(ests[p][wk]) for p in use], weights=wt))
            s = float(min(float(sigs[p][wk]) for p in use))
            src = "+".join(use)
        out.loc[wk] = [e, e * np.exp(-z * s), e * np.exp(z * s), s, src]
    for c in ("est", "lo", "hi", "sigma"):
        out[c] = out[c].astype(float)
    return out
