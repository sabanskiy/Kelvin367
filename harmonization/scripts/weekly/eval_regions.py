"""Does the method generalize beyond Europe? Regions: Chile, Canada, Indonesia, South Africa (FIRMS country archives, 2003-2024)
next to the five European areas, all built the same way (archives only, profile conf_persistent, S-NPP -> MODIS link).

Reported: share of detections removed by the persistent-pixel rule, k (day / night) trained 2012-2021, hold-out error 2022-2024 (own k and
the pooled k of the other areas, leave-one-area-out), year-to-year stability of k, season windows (and whether a window crosses the
turn of the year), and the detection of known events.

    python eval/eval_regions.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
from kelvin367_harmonization.weekly import calendar as cal, chain, firms, seasons  # noqa: E402

pd.set_option("display.width", 220)
EU = ["Ukraine", "Spain", "Portugal", "Greece", "Italy"]
NEW = ["Chile", "Canada", "Indonesia", "South_Africa"]
START, END = "2003-01-06", "2024-12-30"
PAD = pd.Timedelta(days=7)

W, DF, INFO = {}, {}, []


TR = ("2012-01-01", "2021-12-31")


def holdout(c, link, test_mask):
    w = W[c]; m = test_mask[c]
    te = w[m]
    est, sig = chain.Chain().add(link).convert(te[("SNPP", "D")], te[("SNPP", "N")], "SNPP", "MODIS")
    act = te[("MODIS", "D")] + te[("MODIS", "N")]
    ok = (act >= 10) & (est >= 10)
    if ok.sum() == 0:
        return {"n": 0}
    e = np.log(est[ok] / act[ok])
    lo, hi = est * np.exp(-chain.Z80 * sig), est * np.exp(chain.Z80 * sig)
    return {"n": int(ok.sum()), "err": round(float(np.median(np.abs(e))), 3), "bias": round(float(e.mean()), 3), "cov80": round(float(((act[ok] >= lo[ok]) & (act[ok] <= hi[ok])).mean()), 2)}


def main() -> int:
    for c in EU + NEW:
        raw = firms.load_country(c, years=range(2003, 2025))
        raw = raw[raw.platform.isin(["Terra", "Aqua", "SNPP"])]
        conf = raw[raw.conf_ok]
        df = firms.apply_profile(raw, "conf_persistent")
        w = chain.weekly_platform_table(df, START, END)
        W[c], DF[c] = w, df
        night = (df[df.platform == "SNPP"].daynight == "N").mean()
        INFO.append({"area": c, "rows": len(raw), "conf_ok %": round(100 * len(conf) / len(raw), 1), "removed by rule %": round(100 * (1 - len(df) / max(len(conf), 1)), 1),
                     "type!=0 %": round(100 * (raw.type != 0).mean(), 1), "S-NPP night %": round(100 * night, 0)})
    print("=== Data ===")
    print(pd.DataFrame(INFO).to_string(index=False))
    links = {c: chain.estimate_link(W[c], "SNPP", "MODIS", train=TR) for c in W}
    valid = {c: chain.valid_mask(W[c].index, ["SNPP"])["SNPP"].to_numpy() for c in W}
    test_mask = {c: (W[c].index >= "2022-01-03") & valid[c] for c in W}

    rows = []
    for c in W:
        others = [o for o in W if o != c]
        kd = float(np.exp(np.mean([np.log(links[o].k_day) for o in others]))); kn = float(np.exp(np.mean([np.log(links[o].k_night) for o in others])))
        pooled = chain.Link("SNPP", "MODIS", kd, kn, links[c].sigma, links[c].sigma_sys, links[c].n_weeks)
        own, pl = holdout(c, links[c], test_mask), holdout(c, pooled, test_mask)
        # year-to-year stability of the day k
        ks = []
        for y in range(2012, 2025):
            try:
                ks.append(chain.estimate_link(W[c], "SNPP", "MODIS", train=(f"{y}-01-01", f"{y}-12-31")).k_day)
            except Exception:
                pass
        rows.append({"area": c, "k_day": round(links[c].k_day, 3), "k_night": round(links[c].k_night, 3), "train weeks": links[c].n_weeks,
                     "year-to-year sd of ln k_day": round(float(np.std(np.log(ks), ddof=1)), 2) if len(ks) > 3 else np.nan,
                     "n test": own.get("n"), "err own k": own.get("err"), "bias own": own.get("bias"), "cov80 own": own.get("cov80"),
                     "err pooled k": pl.get("err"), "bias pooled": pl.get("bias")})
    print("\n=== k (MODIS per S-NPP record), hold-out 2022-2024, own k vs pooled k of the other areas ===")
    print(pd.DataFrame(rows).to_string(index=False))

    print("\n=== Season windows of the harmonized weekly record (counting from the climatological minimum) ===")
    H = {}
    for c in W:
        ch = chain.Chain().add(links[c])
        h = chain.harmonize(W[c], ch, chain.valid_mask(W[c].index, ["MODIS", "SNPP"]), target="MODIS")
        H[c] = h["est"].astype(float)
        prof = seasons.climatology(H[c], range(2003, 2022))
        r, win = seasons.season_windows(prof)
        lev = seasons.season_level(prof)
        tab = seasons.season_table(H[c], r, win, lev)
        norm = seasons.season_normal(tab, range(2003, 2022))
        def dl(pos):
            wk = (int(round(pos)) + r) % 52
            return (pd.Timestamp("2021-01-01") + pd.Timedelta(days=7 * wk)).strftime("%d %b")
        desc = "; ".join(f"onset {dl(n.onset_pos)}, peak {dl(n.peak_pos)}, end {dl(n.end_pos)} ({n.length:.0f} wk)" for n in norm.itertuples())
        cross = any(((a + r) % 52) > ((b + r) % 52) for a, b in win)
        print(f"{c:13s} start_week(min)={r:2d} windows={len(win)} crosses year boundary={cross}: {desc}")

    print("\n=== Known events (harmonized weekly record, percentile against other years) ===")
    ev = pd.concat([pd.read_csv(ROOT / "docs" / "research" / "known-events-regions.csv", parse_dates=["start", "end"])], ignore_index=True)
    res = []
    for c in NEW:
        s = H[c]
        p = cal.stratified_percentile(s, s, 9999, "pre")
        ep = seasons.critical_episodes(p, s)
        for e in ev[ev.area == c].itertuples():
            win = (p.index + pd.Timedelta(days=6) >= e.start - PAD) & (p.index <= e.end + PAD)
            mx = float(p[win].max()) if p[win].notna().any() else np.nan
            cov = bool(len(ep) and ((ep.start <= e.end + PAD) & (ep.end >= e.start - PAD)).any())
            res.append({"id": e.id, "scale": e.scale, "conf": e.date_confidence, "max percentile": round(mx), "P90": mx >= 90, "episode >=2wk": cov})
    R = pd.DataFrame(res)
    print(R.to_string(index=False))
    print(f"detected P90: {int(R['P90'].sum())}/{len(R)}; covered by an episode: {int(R['episode >=2wk'].sum())}/{len(R)}")
    print(R.groupby("scale")[["P90", "episode >=2wk"]].agg(["sum", "count"]).to_string())
    R.to_csv(ROOT / "docs" / "research" / "known-events-regions-results.csv", index=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
