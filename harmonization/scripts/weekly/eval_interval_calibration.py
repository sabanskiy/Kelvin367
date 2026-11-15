"""Is the 80% interval of the S-NPP -> MODIS conversion really an 80% interval, and can a scale factor fix it?

Rolling origin (no test data used for any choice):
  link   trained 2012-2019            (k and the sigma model of chain.estimate_link)
  scale  chosen on 2020-2021          (c = quantile_0.80(|ln(actual/pred)| / sigma) / 1.2816)
  test   2022 .. end of the record    (coverage of +-1.2816 * c * sigma)
Weeks with >= 10 MODIS records and >= 10 predicted records only. Ten areas: the six continuous presets and the four archive regions.

    python eval/eval_interval_calibration.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
from kelvin367_harmonization.weekly import areas, chain, config, firms  # noqa: E402

pd.set_option("display.width", 220)

REGIONS = {"chile": "Chile", "canada": "Canada", "indonesia": "Indonesia", "south_africa": "South_Africa"}


def tables(loader):
    out = {}
    for key in config.AREAS:
        out[key] = loader.record(key)[1]
    for key, c in REGIONS.items():
        raw = firms.load_country(c, years=range(2003, 2025))
        df = firms.apply_profile(raw[raw.platform.isin(["Terra", "Aqua", "SNPP"])], "conf_persistent")
        out[key] = chain.weekly_platform_table(df, "2003-01-06", "2024-12-23")
    return out


def residuals(w):
    link = chain.estimate_link(w, "SNPP", "MODIS", train=("2012-01-01", "2019-12-31"))
    valid = chain.valid_mask(w.index, ["SNPP"])["SNPP"].to_numpy()
    m = (w.index >= "2020-01-06") & valid
    te = w[m]
    pred, sig = chain.Chain().add(link).convert(te[("SNPP", "D")], te[("SNPP", "N")], "SNPP", "MODIS")
    act = te[("MODIS", "D")] + te[("MODIS", "N")]
    ok = (act >= 10) & (pred >= 10)
    r = np.log(act[ok] / pred[ok]) / sig[ok]
    return pd.DataFrame({"r": r, "pred": pred[ok], "year": r.index.year})


def main() -> int:
    LOADER = areas.AreaLoader()

    T = tables(LOADER)
    R = {k: residuals(w) for k, w in T.items()}
    rows = []
    allv = pd.concat([r[r.year <= 2021].r.abs() for r in R.values()])
    c_pool = float(np.quantile(allv, 0.8) / chain.Z80)
    for k, r in R.items():
        v, t = r[r.year <= 2021], r[r.year >= 2022]
        c_own = float(np.quantile(v.r.abs(), 0.8) / chain.Z80) if len(v) >= 20 else np.nan
        cov = lambda x, c=1.0: round(float((x.r.abs() <= chain.Z80 * c).mean()), 2) if len(x) else np.nan
        rows.append({"area": k, "n val": len(v), "n test": len(t), "cov val (nominal)": cov(v), "cov test (nominal)": cov(t), "c own": round(c_own, 2),
                     "cov test (own c)": cov(t, c_own), f"cov test (pooled c={c_pool:.2f})": cov(t, c_pool)})
    tab = pd.DataFrame(rows)
    print(tab.to_string(index=False))
    allt = pd.concat([r[r.year >= 2022] for r in R.values()])
    print(f"\npooled validation c = {c_pool:.3f}; pooled test coverage nominal {float((allt.r.abs() <= chain.Z80).mean()):.2f}, "
          f"with pooled c {float((allt.r.abs() <= chain.Z80 * c_pool).mean()):.2f}")
    print("\ncoverage on test by predicted size (nominal / pooled c):")
    for lab, lo, hi in (("<30", 0, 30), ("30-100", 30, 100), (">=100", 100, 1e12)):
        s = allt[(allt.pred >= lo) & (allt.pred < hi)]
        print(f"  {lab:7s} n={len(s):4d}  {float((s.r.abs() <= chain.Z80).mean()):.2f} / {float((s.r.abs() <= chain.Z80 * c_pool).mean()):.2f}")
    print("\ncoverage on test by year (nominal / pooled c):")
    for y, s in allt.groupby("year"):
        print(f"  {y}  n={len(s):4d}  {float((s.r.abs() <= chain.Z80).mean()):.2f} / {float((s.r.abs() <= chain.Z80 * c_pool).mean()):.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
