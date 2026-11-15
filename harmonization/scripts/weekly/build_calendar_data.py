"""Build the JSON data files of the Kelvin367 calendar prototype (app/data/).

AOIs: Ukraine, Spain, Portugal, Iberia (Spain + Portugal), Greece, Italy. Each is the
Natural Earth country polygon, Ukraine point of view (intersected with the FIRMS API rectangle) and one record built by `kelvin367_harmonization.weekly.continuous`: yearly
archives up to 2024 (Terra, Aqua, S-NPP), API from 2025 (all platforms) and NOAA-20/21 from the API throughout; one filter profile
(`conf_persistent`: confidence + persistent-pixel rule, no `type`). For each AOI: weekly counts per platform, a naive stitched series,
the harmonized series (actual MODIS where valid, otherwise reconstructed from VIIRS through the calibration chain, with an 80%
interval), a VIIRS-only reconstruction (the "what if MODIS ended" slider), seasonal percentiles, known gaps, drift effects, links.

Run from repo root:  python scripts/build_calendar_data.py
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
from kelvin367_harmonization.weekly import areas, calendar as cal, chain, config, drift, firms, policy, sensors  # noqa: E402


OUT = ROOT / "output" / "calendar"


def lst(s, nd=1):
    return [None if (v is None or (isinstance(v, float) and np.isnan(v))) else round(float(v), nd) for v in s]


def total(w, p):
    return w[(p, "D")] + w[(p, "N")] if (p, "D") in w.columns else pd.Series(np.nan, index=w.index)


def link_info(l):
    return {"source": l.source, "target": l.target, "k_day": round(l.k_day, 4), "k_night": round(l.k_night, 4),
            "sigma": [round(x, 3) for x in l.sigma], "sigma_sys": round(l.sigma_sys, 3), "weeks": l.n_weeks}


def drift_rows(df, ref_years, last_year, start, end, valid_snpp_weeks):
    """Year effects (percent change vs reference years) for Terra day, Aqua day, MODIS night and MODIS total."""
    ws = chain.weekly_platform_table(df, start, end, split_modis=True)
    wg = chain.weekly_platform_table(df, start, end)
    vs = pd.Series(valid_snpp_weeks, index=ws.index)
    comps = {"Terra day": (ws, "Terra", ("D",), 10), "Aqua day": (ws, "Aqua", ("D",), 10),
             "MODIS night": (wg, "MODIS", ("N",), 5), "MODIS total": (wg, "MODIS", ("D", "N"), 10)}
    rows = {}
    for name, (w, num, dn, mc) in comps.items():
        try:
            panel = drift.panel_from_weekly({"a": w}, {"a": vs}, num=num, den="SNPP", dn=dn)
            eff = drift.fit_year_effects(panel, ref_years, last_year, min_count=mc).summary()
            for _, r in eff.iterrows():
                rows.setdefault(int(r["year"]), {})[name] = [round(r.change_pct, 1), round(r.ci_lo_pct, 1), round(r.ci_hi_pct, 1)]
        except Exception:
            continue
    return [{"year": y, **v} for y, v in sorted(rows.items())]


def platform_info():
    out = []
    for p in sensors.PLATFORMS.values():
        out.append({"name": p.name, "family": p.family, "start": p.start.isoformat(),
                    "end": p.end.isoformat() if p.end else None, "planned_end": p.planned_end, "local_time": p.nominal_local_time})
    return out


def finish(aoi_id, name, kind, w, ch, platforms, baseline_years, extra_series, links, drift_table, geometry_note, extra_gaps=()):
    all_gaps = list(sensors.KNOWN_GAPS) + list(extra_gaps)
    valid = chain.valid_mask(w.index, platforms, gaps=all_gaps)
    harm = chain.harmonize(w, ch, valid, target="MODIS")
    v2 = valid.copy(); v2["MODIS"] = False
    harm_v = chain.harmonize(w, ch, v2, target="MODIS")
    idx = w.index
    pct = cal.seasonal_percentile(harm["est"], baseline_years)
    # baseline for pct_v must be the default (actual MODIS) series
    base = harm["est"].copy()
    woy = cal.week_of_year(idx); base_mask = np.isin(idx.year, list(baseline_years)); bv = base.to_numpy(dtype=float)
    pv = np.full(len(idx), np.nan)
    for i in range(len(idx)):
        x = harm_v["est"].iloc[i]
        if np.isnan(x):
            continue
        d = np.abs(woy - woy[i]); near = base_mask & (np.minimum(d, 52 - d) <= 1) & ~np.isnan(bv)
        smp = bv[near]
        if len(smp) >= 5:
            pv[i] = 100.0 * ((smp < x).sum() + 0.5 * (smp == x).sum()) / len(smp)
    codes = sorted(set(harm["sources"].astype(str)) | set(harm_v["sources"].astype(str)))
    code_of = {c: i for i, c in enumerate(codes)}
    gaps = {}
    for p in platforms:
        if p == "MODIS":
            if extra_gaps:  # weeks of the MODIS era with no data in this build
                gaps[p] = [int(i) for i in np.where((idx >= pd.Timestamp(chain.MODIS_TWO_SATELLITE_START)) & ~valid[p].to_numpy())[0]]
            continue
        pl = sensors.PLATFORMS[p]
        operating = np.array([(wk.date() >= pl.start) and (pl.end is None or (wk + pd.Timedelta(days=6)).date() <= pl.end) for wk in idx])
        gaps[p] = [int(i) for i in np.where(operating & ~valid[p].to_numpy())[0]]  # known gaps inside the operating period
    series = {"modis": lst(total(w, "MODIS"), 0), **{k: lst(v, 0) for k, v in extra_series.items()},
              "harm": {"est": lst(harm["est"]), "lo": lst(harm["lo"]), "hi": lst(harm["hi"]), "src": [code_of[str(x)] for x in harm["sources"]]},
              "harm_viirs": {"est": lst(harm_v["est"]), "lo": lst(harm_v["lo"]), "hi": lst(harm_v["hi"]), "src": [code_of[str(x)] for x in harm_v["sources"]]}}
    data = {"id": aoi_id, "name": name, "kind": kind, "geometry_note": geometry_note,
            "weeks": [d.date().isoformat() for d in idx], "series": series, "src_codes": codes,
            "anomaly": {"baseline": f"{min(baseline_years)}-{max(baseline_years)}", "pct": lst(pct, 1), "pct_viirs": lst(pd.Series(pv, index=idx), 1)},
            "gap_weeks": gaps,
            "quality": {"links": [link_info(l) for l in links], "drift": drift_table, "platforms": platform_info(),
                        "filter_profile": firms.profile_info({"country": "archive_type0", "continuous": "conf_persistent", "archive": "conf_persistent"}.get(kind, "api_conf_persistent")),
                        "interval": {"nominal": 0.8, "scale": chain.INTERVAL_SCALE, "z": round(chain.INTERVAL_Z, 4), "held_out_coverage": 0.78,
                                     "by_area_range": [0.66, 0.89], "source": "docs/research/interval-calibration-e0-47.md"},
                        "known_gaps": [{"platform": g.platform, "start": g.start.isoformat(), "end": g.end.isoformat()} for g in all_gaps],
                        "unit": "weekly count of fire detections (records) in the AOI"}}
    return data, valid

# ---------------- other regimes: archives only (MODIS 2003-2024, S-NPP 2012-2024), same filter profile, S-NPP -> MODIS link
REGIONS = {"chile": ("Chile", "Chile (central Chile and the whole country)"), "canada": ("Canada", "Canada"),
           "indonesia": ("Indonesia", "Indonesia"), "south_africa": ("South_Africa", "South Africa")}


def main() -> int:
    _ap = argparse.ArgumentParser(description="Build app/data/*.json (presets and index).")
    _ap.add_argument("--as-of", help="build date YYYY-MM-DD for the publication lag and the index (default: KELVIN_AS_OF or today)")
    _args = _ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    index = []

    policy.set_as_of(_args.as_of)

    LOADER = areas.AreaLoader()
    for key, a in config.AREAS.items():
        print("continuous", key, flush=True)
        df, w = LOADER.record(key)
        modis_api_end = df[(df.platform.isin(["Terra", "Aqua"])) & (df.time_utc >= f"{config.SPLIT_YEAR}-01-01")].time_utc.max()
        extra_gaps = []
        if pd.isna(modis_api_end):  # Greece and Italy: MODIS from the API has not been downloaded for 2025-2026
            extra_gaps = [sensors.Gap("MODIS", date(2025, 1, 1), date(2026, 10, 5), "MODIS data for 2025-2026 were not downloaded for this area")]
        l_m = chain.estimate_link(w, "SNPP", "MODIS", train=config.LINK_TRAIN[("SNPP", "MODIS")])
        l_20 = chain.estimate_link(w, "SNPP", "NOAA20", train=config.LINK_TRAIN[("SNPP", "NOAA20")])
        l_21 = chain.estimate_link(w, "NOAA20", "NOAA21", train=config.LINK_TRAIN[("NOAA20", "NOAA21")])
        ch = chain.Chain().add(l_m).add(l_20).add(l_21)
        vsn = chain.valid_mask(w.index, ["SNPP"])["SNPP"].to_numpy()
        dtab = drift_rows(df, set(range(config.DRIFT_REF_YEARS[0], config.DRIFT_REF_YEARS[1] + 1)), 2026, "2003-01-06", str(w.index[-1].date()), vsn)
        naive = cal.naive_stitch(total(w, "MODIS"), total(w, "SNPP"), config.NAIVE_CUTOFF)
        note = (f"Natural Earth (Ukraine point of view) country polygon intersected with the FIRMS API rectangle {a['bbox']}; one record: yearly archives up to 2024 (Terra, Aqua, S-NPP) "
                f"and the FIRMS API from 2025 (all platforms; NOAA-20/21 from the API throughout); confidence filter and persistent-pixel rule, no `type` filter. "
                f"Links are trained on {config.LINK_TRAIN[('SNPP', 'NOAA20')][0]}..{config.LINK_TRAIN[('SNPP', 'NOAA20')][1]} (S-NPP to NOAA-20) and "
                f"{config.LINK_TRAIN[('NOAA20', 'NOAA21')][0]}..{config.LINK_TRAIN[('NOAA20', 'NOAA21')][1]} (NOAA-20 to NOAA-21)."
                + (" MODIS data of 2025-2026 are not included in this build (not downloaded), so those weeks are reconstructed from VIIRS." if extra_gaps else ""))
        d, _ = finish(key, a["name"], "continuous", w, ch, ["MODIS", "SNPP", "NOAA20", "NOAA21"], range(config.BASELINE_YEARS[0], config.BASELINE_YEARS[1] + 1),
                      {"viirs_snpp": total(w, "SNPP"), "viirs_noaa20": total(w, "NOAA20"), "viirs_noaa21": total(w, "NOAA21"), "naive": naive},
                      [l_m, l_20, l_21], dtab, note, extra_gaps)
        # fire radiative power: the same chain on weekly FRP sums; nominal 80% interval (its held-out coverage was 0.84, see eval_frp.py)
        wf = areas.frp_table(df, str(w.index[-1].date()))
        f_m = chain.estimate_link(wf, "SNPP", "MODIS", train=config.LINK_TRAIN[("SNPP", "MODIS")])
        f_20 = chain.estimate_link(wf, "SNPP", "NOAA20", train=config.LINK_TRAIN[("SNPP", "NOAA20")])
        f_21 = chain.estimate_link(wf, "NOAA20", "NOAA21", train=config.LINK_TRAIN[("NOAA20", "NOAA21")])
        hf = chain.harmonize(wf, chain.Chain().add(f_m).add(f_20).add(f_21), chain.valid_mask(wf.index, ["MODIS", "SNPP", "NOAA20", "NOAA21"], gaps=list(sensors.KNOWN_GAPS) + list(extra_gaps)),
                             target="MODIS", z=chain.Z80)
        codes = d["src_codes"]
        for sname in sorted(set(hf["sources"].astype(str))):
            if sname not in codes:
                codes.append(sname)
        d["series"]["frp"] = {"est": lst(hf["est"], 0), "lo": lst(hf["lo"], 0), "hi": lst(hf["hi"], 0), "src": [codes.index(str(x)) for x in hf["sources"]]}
        d["series"]["frp_modis"] = lst(total(wf, "MODIS"), 0)
        d["series"]["frp_snpp"] = lst(total(wf, "SNPP"), 0)
        d["quality"]["frp_links"] = [link_info(l) for l in (f_m, f_20, f_21)]
        d["quality"]["frp_unit"] = "weekly sum of fire radiative power (MW) of the detections in the AOI; nominal 80% interval"
        if key in policy.LAG_DAYS:
            d["data_policy"] = {"lag_days": policy.LAG_DAYS[key], "as_of": policy.as_of().isoformat(), "reason": "ukraine_no_near_real_time"}
        (OUT / f"{key}.json").write_text(json.dumps(d, separators=(",", ":")), encoding="utf-8")
        index.append({"id": key, "name": d["name"], "kind": "continuous", "from": d["weeks"][0], "to": d["weeks"][-1],
                      "platforms": ["MODIS", "SNPP", "NOAA20", "NOAA21"]})
    for key, (country, nm) in REGIONS.items():
        print("region", key, flush=True)
        raw = firms.load_country(country, years=range(2003, 2025))
        df = firms.apply_profile(raw[raw.platform.isin(["Terra", "Aqua", "SNPP"])], "conf_persistent")
        w = chain.weekly_platform_table(df, "2003-01-06", "2024-12-23")
        lk = chain.estimate_link(w, "SNPP", "MODIS", train=config.LINK_TRAIN[("SNPP", "MODIS")])
        ch = chain.Chain().add(lk)
        vsn = chain.valid_mask(w.index, ["SNPP"])["SNPP"].to_numpy()
        dtab = drift_rows(df, set(range(2012, 2020)), 2024, "2003-01-06", "2024-12-23", vsn)
        naive = cal.naive_stitch(total(w, "MODIS"), total(w, "SNPP"), config.NAIVE_CUTOFF)
        note = ("FIRMS yearly country archive (MODIS 2003-2024, S-NPP 2012-2024); confidence filter and persistent-pixel rule, no `type` filter; "
                "no NOAA-20/21 and no 2025-2026 in this build, so only the S-NPP to MODIS link is calibrated. "
                "Link trained 2012-2021, hold-out error and regime comparison: docs/research/regions-e0-38.md.")
        d, _ = finish(key, nm, "archive", w, ch, ["MODIS", "SNPP"], range(2003, 2022), {"viirs_snpp": total(w, "SNPP"), "naive": naive}, [lk], dtab, note)
        (OUT / f"{key}.json").write_text(json.dumps(d, separators=(",", ":")), encoding="utf-8")
        index.append({"id": key, "name": d["name"], "kind": "archive", "from": d["weeks"][0], "to": d["weeks"][-1], "platforms": ["MODIS", "SNPP"]})

    (OUT / "index.json").write_text(json.dumps({"generated": policy.as_of().isoformat(), "aois": index,
                                                 "disclaimer": "Independent prototype; not endorsed by NASA. Data: NASA FIRMS (MODIS, VIIRS)."},
                                                ensure_ascii=False, indent=1), encoding="utf-8")
    total_bytes = sum(f.stat().st_size for f in OUT.glob("*.json"))
    print("written:", [f.name for f in sorted(OUT.glob("*.json"))], f"{total_bytes/1e6:.2f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
