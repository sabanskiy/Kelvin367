import numpy as np
import pandas as pd
import pytest

pytest.importorskip("shapely")
from shapely.geometry import box  # noqa: E402

from kelvin367_harmonization.weekly import chain, continuous, firms  # noqa: E402
from kelvin367_harmonization.weekly.sensors import Gap  # noqa: E402


def det(platform, times, lat=48.0, lon=30.0, step=0.05):
    n = len(times)
    return pd.DataFrame({"time_utc": pd.to_datetime(times, utc=True), "lat": lat + step * np.arange(n), "lon": lon, "platform": platform,
                         "daynight": "D", "type": 0, "conf_ok": True, "frp": 1.0, "country": "x"})


def test_mask_cuts_rows_by_polygon():
    d = pd.concat([det("SNPP", ["2020-07-01"] * 3, lat=48.0), det("SNPP", ["2020-07-01"] * 2, lat=60.0)], ignore_index=True)
    out = continuous.in_mask(d, box(29, 47, 31, 50))
    assert len(out) == 3 and out.lat.max() < 50


def test_each_platform_comes_from_one_source_per_period():
    arch = pd.concat([det("Terra", ["2024-06-01", "2024-12-31", "2025-01-02"], lat=48.0), det("SNPP", ["2023-05-01"], lat=49.0)], ignore_index=True)
    api = pd.concat([det("Terra", ["2024-06-01", "2025-01-03", "2026-02-01"], lat=50.0),     # overlap 2024-06-01 must not be counted twice
                     det("NOAA20", ["2023-05-01"], lat=51.0), det("SNPP", ["2025-03-01"], lat=52.0)], ignore_index=True)
    out = continuous.assemble(arch, api)
    t = out[out.platform == "Terra"]["time_utc"].dt.strftime("%Y-%m-%d").tolist()
    # archive rows before 2025 (2), API rows from 2025 (2); archive 2025-01-02 and API 2024-06-01 are dropped
    assert sorted(t) == ["2024-06-01", "2024-12-31", "2025-01-03", "2026-02-01"]
    assert set(out.platform) == {"Terra", "SNPP", "NOAA20"} and len(out) == 4 + 1 + 1 + 1


def test_assemble_applies_the_unified_filter():
    days = pd.date_range("2025-03-01", periods=12, freq="D", tz="UTC")
    static = pd.DataFrame({"time_utc": days, "lat": 48.001, "lon": 30.001, "platform": "NOAA21", "daynight": "D", "type": firms.UNKNOWN_TYPE, "conf_ok": True})
    low = det("NOAA20", ["2025-03-01"]); low["conf_ok"] = False
    out = continuous.assemble(det("Terra", ["2020-01-01"]), pd.concat([static, low], ignore_index=True))
    assert set(out.platform) == {"Terra"}          # static pixel (12 days in a month) and low confidence removed


def test_valid_mask_honours_modis_gaps():
    weeks = pd.date_range("2025-01-06", periods=6, freq="W-MON")
    g = [Gap("MODIS", pd.Timestamp("2025-01-20").date(), pd.Timestamp("2025-02-09").date())]
    v = chain.valid_mask(weeks, ["MODIS"], gaps=g)["MODIS"].tolist()
    assert v == [True, True, False, False, False, True]


def test_static_pixels_are_learned_from_type_and_removed_from_every_platform():
    days = pd.date_range("2024-03-01", periods=5, freq="D", tz="UTC")
    flare = pd.DataFrame({"time_utc": days, "lat": 45.001, "lon": 12.001, "platform": "SNPP", "daynight": "N", "type": 2, "conf_ok": True})
    fire = det("SNPP", ["2024-07-01"], lat=48.0)                                        # a vegetation fire elsewhere
    near_miss = pd.DataFrame({"time_utc": days[:2], "lat": 44.5, "lon": 12.0, "platform": "SNPP", "daynight": "D", "type": 2, "conf_ok": True})   # only 2 days
    px = firms.static_pixels(pd.concat([flare, fire, near_miss], ignore_index=True), min_days=3)
    assert len(px) == 1
    # NOAA-21 rows (unknown type) in the same pixel are dropped as well; a fire in another pixel stays
    n21 = pd.DataFrame({"time_utc": days[:1], "lat": 45.002, "lon": 12.002, "platform": "NOAA21", "daynight": "D", "type": firms.UNKNOWN_TYPE, "conf_ok": True})
    both = pd.concat([n21, fire], ignore_index=True)
    kept = firms.drop_pixels(both, px)
    assert list(kept.platform) == ["SNPP"] and len(kept) == 1
