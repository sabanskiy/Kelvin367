import pandas as pd

from kelvin367_harmonization.weekly import firms


def test_load_file_modis_and_viirs(tmp_path):
    m = tmp_path / "modis_2023_X.csv"
    m.write_text(
        "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight,type\n"
        "48.0,30.0,325,1,1,2023-01-02,0855,Terra,MODIS,20,61.03,273.9,28.6,D,0\n"
        "48.0,30.0,325,1,1,2023-01-02,1855,Aqua,MODIS,80,61.03,273.9,28.6,N,2\n"
    )
    v = tmp_path / "viirs-snpp_2023_X.csv"
    v.write_text(
        "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight,type\n"
        "48.0,30.0,327,0.4,0.4,2023-01-01,1118,N,VIIRS,l,2,273.7,2.5,D,0\n"
        "48.0,30.0,327,0.4,0.4,2023-01-01,2332,N,VIIRS,h,2,274.9,3.1,N,0\n"
    )
    a, b = firms.load_file(m), firms.load_file(v)
    assert list(a["conf_ok"]) == [False, True]
    assert list(b["conf_ok"]) == [False, True]
    assert set(a["platform"]) == {"Terra", "Aqua"} and set(b["platform"]) == {"SNPP"}
    assert a["time_utc"].iloc[0] == pd.Timestamp("2023-01-02 08:55", tz="UTC")
    assert abs(a["solar_hour"].iloc[0] - (8 + 55 / 60 + 2)) < 1e-9


def test_nrt_file_without_type_column(tmp_path):
    f = tmp_path / "viirs-snpp_2026_X.csv"
    f.write_text(
        "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight\n"
        "48.0,30.0,327,0.4,0.4,2026-07-01,126,N,VIIRS,n,2,273.7,2.5,N\n"
    )
    d = firms.load_file(f)
    assert d["type"].iloc[0] == firms.UNKNOWN_TYPE
    assert len(firms.natural(d)) == 1 and len(firms.natural(d, keep_unknown_type=False)) == 0
    assert d["platform"].iloc[0] == "SNPP"


def test_header_only_file_is_empty(tmp_path):
    f = tmp_path / "viirs-snpp_2026_X.csv"
    f.write_text("latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight\n")
    assert firms.load_file(f).empty


def test_natural_drops_persistent_pixels_only_for_unknown_type():
    days = pd.date_range("2026-08-01", periods=12, freq="D", tz="UTC")
    def rows(lat, lon, typ, ds):
        return pd.DataFrame({"time_utc": ds, "lat": lat, "lon": lon, "platform": "SNPP", "type": typ, "conf_ok": True})
    d = pd.concat([
        rows(48.001, 30.001, firms.UNKNOWN_TYPE, days),            # static source: 12 days, unknown type -> dropped
        rows(48.5, 31.0, firms.UNKNOWN_TYPE, days[:3]),            # ordinary NRT fire: 3 days -> kept
        rows(49.0, 32.0, firms.VEGETATION, days),                  # known type 0 -> never dropped, even if persistent
        rows(50.0, 33.0, 2, days),                                 # known static type -> removed by type as before
    ], ignore_index=True)
    out = firms.natural(d)
    assert len(out) == 3 + 12
    assert len(firms.natural(d, drop_persistent=False)) == 12 + 3 + 12
    assert len(firms.natural(d, keep_unknown_type=False)) == 12
    # same pixel in another month does not accumulate
    split = pd.concat([rows(48.0, 30.0, firms.UNKNOWN_TYPE, days[:6]), rows(48.0, 30.0, firms.UNKNOWN_TYPE, days[:6] + pd.Timedelta(days=40))], ignore_index=True)
    assert len(firms.natural(split)) == 12
