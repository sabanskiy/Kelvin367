"""The test of the 2012 transition with a second burned-area reference, GFED5, next to MCD64A1.

GFED5 burned area (Chen et al. 2023, Zenodo 10.5281/zenodo.7668424, CC BY 4.0): monthly files `BAYYYYMM.nc`, 0.25 degree, 2001-2020, layers
Total / Crop / Norm / Defo / Peat in km2 per cell and month. Read here: Total, and Crop for a sensitivity run without cropland burning.
The dataset authors list discontinuities in 1998, 2001 and 2003 (new satellites in the burned-area record), all before the windows of the test
(2006-2011 against 2013-2018). GFED5 is still a MODIS-based product at its core, so the two references are not independent of MODIS hotspots.

Country masks: the same polygons as the presets (Natural Earth, cut by the API rectangle). A 0.25 degree cell is split into 10 x 10 points; the
share of points inside the mask is the share of the cell that is counted, and the burned area of a cell is taken as uniform inside it. This
is coarse for small countries and at borders (stated in the document).

Everything else (series, thresholds, windows, bootstrap, pooling) is the code of eval_burnt_area_2012.py, imported, so the two references are
treated the same way.

    python eval/eval_transition_gfed5.py       # needs data/raw/gfed5/BA/ (Zenodo 7668424, BA.zip, 265 MB, not in git)
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from kelvin367_harmonization.weekly import config, continuous  # noqa: E402

import eval_burnt_area_2012 as e52  # noqa: E402

GFED = ROOT / "data" / "raw" / "gfed5" / "BA"
CACHE = ROOT / "data" / "interim" / "gfed5_monthly_ha.csv"
DEG = 0.25
SUB = 10                                  # sub-points per cell edge for the mask share
YEARS = range(2001, 2021)
WEST, SOUTH, EAST, NORTH = -10.5, 34.0, 42.0, 53.5


def read_month(path: Path, layers=("Total", "Crop")) -> dict[str, np.ndarray]:
    """{layer: [nlat, nlon] km2} of the box WEST..EAST, SOUTH..NORTH, and the cell-centre vectors."""
    import h5py

    with h5py.File(path, "r") as f:
        lat, lon = f["lat"][:], f["lon"][:]
        i = np.where((lat >= SOUTH) & (lat <= NORTH))[0]
        j = np.where((lon >= WEST) & (lon <= EAST))[0]
        out = {k: np.nan_to_num(f[k][0, i[0]:i[-1] + 1, j[0]:j[-1] + 1].astype(float)) for k in layers}
    out["lat"], out["lon"] = lat[i], lon[j]
    return out


def cell_share(geom, lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    """[nlat, nlon] share of every 0.25 degree cell that lies inside `geom` (SUB x SUB sample points per cell)."""
    import shapely

    off = (np.arange(SUB) + 0.5) / SUB * DEG - DEG / 2
    la = (lat[:, None] + off[None, :]).reshape(-1)
    lo = (lon[:, None] + off[None, :]).reshape(-1)
    shapely.prepare(geom)
    LA, LO = np.meshgrid(la, lo, indexing="ij")
    inside = shapely.contains_xy(geom, LO.reshape(-1), LA.reshape(-1)).reshape(LA.shape)
    return inside.reshape(len(lat), SUB, len(lon), SUB).mean(axis=(1, 3))


def monthly_ha() -> pd.DataFrame:
    """Burned area in ha per month and area for the layers Total and Crop: columns (area, layer)."""
    if CACHE.exists():
        df = pd.read_csv(CACHE, index_col=0, header=[0, 1], parse_dates=True)
        return df
    shares = {}
    rows = {}
    for y in YEARS:
        for m in range(1, 13):
            d = read_month(GFED / f"BA{y}{m:02d}.nc")
            if not shares:
                for key, a in config.AREAS.items():
                    shares[key] = cell_share(continuous.country_mask(a["ne"], a["bbox"]), d["lat"], d["lon"])
            rows[pd.Timestamp(y, m, 1)] = {(k, layer): float((d[layer] * s).sum()) * 100.0 for k, s in shares.items() for layer in ("Total", "Crop")}   # km2 -> ha
    df = pd.DataFrame(rows).T
    df.columns = pd.MultiIndex.from_tuples(df.columns)
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(CACHE)
    return df


def step_table(ha: pd.DataFrame, areas) -> tuple[pd.DataFrame, dict]:
    rows, resid = [], {}
    for area in areas:
        s = e52.series(area)
        for name in e52.SCALED:
            thr = e52.MIN_SERIES if name != "frp_naive" else e52.MIN_SERIES * 10
            ref = ha[area].reindex(s.index)
            ok = (s[name] >= thr) & (ref >= e52.MIN_HA)
            r = np.log(ref[ok] / s[name][ok])
            resid[(area, name)] = r
            p, lo, hi, nb, na = e52.step(r)
            rows.append({"area": area, "series": name, "factor": np.exp(p), "ci_lo": np.exp(lo), "ci_hi": np.exp(hi), "years_before": nb, "years_after": na,
                         "months": int(ok.sum())})
    return pd.DataFrame(rows), resid


def main() -> int:
    if not GFED.exists() or not any(GFED.glob("BA2014??.nc")):
        print("no GFED5 files in data/raw/gfed5/BA: download BA.zip from Zenodo 10.5281/zenodo.7668424 and unzip there", file=sys.stderr)
        return 2
    g = monthly_ha()
    m = e52.monthly_ha()
    print("annual burned area, ha: GFED5 Total / MCD64A1 (ratio), 2003-2020:")
    for a in config.AREAS:
        gy, my = g[(a, "Total")].groupby(g.index.year).sum(), m[a].groupby(m.index.year).sum()
        yrs = [y for y in range(2003, 2021)]
        ratio = (gy.loc[yrs] / my.loc[yrs])
        mo = pd.concat([g[(a, "Total")], m[a]], axis=1, keys=["g", "m"]).loc["2003":"2020"]
        print(f"  {a:9s} median annual ratio GFED5 / MCD64A1 {ratio.median():.2f} (range {ratio.min():.2f}..{ratio.max():.2f}); monthly Spearman {mo.g.corr(mo.m, method='spearman'):.2f}; "
              f"cropland share of GFED5 total {g[(a, 'Crop')].sum() / g[(a, 'Total')].sum():.2f}")
    ref = {"GFED5 Total": g.xs("Total", axis=1, level=1), "GFED5 Total - Crop": g.xs("Total", axis=1, level=1) - g.xs("Crop", axis=1, level=1), "MCD64A1": m}
    results = {}
    for name, ha in ref.items():
        t, resid = step_table(ha, config.AREAS)
        results[name] = (t, resid)
    print("\nStep of 2012 as a factor (1 = no step), 95 % interval, by reference:")
    for series in e52.SCALED:
        print(f"\n--- series {series} ---")
        tab = pd.DataFrame({name: t[t.series == series].set_index("area").apply(lambda r: f"{r.factor:.2f} ({r.ci_lo:.2f}..{r.ci_hi:.2f})", axis=1) for name, (t, _) in results.items()})
        print(tab.to_string())
    print("\nPooled over ukraine, spain, portugal, greece, italy (factor, 95 % interval, detection limit):")
    for name, (_, resid) in results.items():
        for series in e52.SCALED:
            p, lo, hi, ny = e52.pooled_step({a: resid[(a, series)] for a in e52.POOL})
            print(f"  {name:20s} {series:11s} {np.exp(p):.2f} ({np.exp(lo):.2f}..{np.exp(hi):.2f})  detectable step x{e52.detection_limit(np.exp(lo), np.exp(hi)):.2f}  years {ny}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
