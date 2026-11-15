from datetime import date

import numpy as np
import pandas as pd

from kelvin367_harmonization.policies import Availability, harmonize_daily


def test_exports_equal_mix_and_viirs_first_from_the_same_calibrated_groups():
    groups = pd.DataFrame(
        {
            "date": pd.to_datetime(["2020-06-09"]),
            "cell_iy": [160],
            "cell_ix": [-15],
            "MODIS": [3.0],
            "SNPP": [0.5],
            "NOAA20": [0.0],
        }
    )
    availability = {
        "MODIS": Availability(date(2003, 1, 1)),
        "SNPP": Availability(date(2012, 1, 20)),
        "NOAA20": Availability(date(2018, 4, 1)),
    }

    got = harmonize_daily(groups, availability, {"SNPP": 0.75, "NOAA20": 0.25}).iloc[0]

    assert np.isclose(got.equal_mix_count_1d, (3.0 + 0.5 + 0.0) / 3)
    assert np.isclose(got.viirs_first_count_1d, 0.375)
    assert got.equal_mix_source == 7
    assert got.viirs_first_source == 6
    assert got.viirs_first_flag == "viirs"


def test_viirs_first_uses_modis_before_viirs_and_during_a_viirs_outage():
    groups = pd.DataFrame(
        {
            "date": pd.to_datetime(["2011-06-09", "2023-07-19", "2023-07-21"]),
            "cell_iy": [160, 160, 160],
            "cell_ix": [-15, -15, -15],
            "MODIS": [2.0, 4.0, 1.0],
            "SNPP": [0.0, 0.0, 0.0],
            "NOAA20": [0.0, 0.0, 0.0],
        }
    )
    availability = {
        "MODIS": Availability(date(2003, 1, 1)),
        "SNPP": Availability(date(2012, 1, 20), gaps=((date(2023, 7, 19), date(2023, 7, 22)),)),
        "NOAA20": Availability(date(2018, 4, 1), gaps=((date(2023, 7, 19), date(2023, 7, 22)),)),
    }

    got = harmonize_daily(groups, availability, {"SNPP": 0.5, "NOAA20": 0.5})

    assert got.viirs_first_count_1d.tolist() == [2.0, 4.0, 1.0]
    assert got.viirs_first_flag.tolist() == ["pre_viirs", "fallback", "fallback"]
    assert got.viirs_first_source.tolist() == [1, 1, 1]


def test_no_available_source_is_nan_and_explicitly_flagged():
    groups = pd.DataFrame(
        {
            "date": pd.to_datetime(["2000-01-01"]),
            "cell_iy": [0],
            "cell_ix": [0],
            "MODIS": [0.0],
            "SNPP": [0.0],
            "NOAA20": [0.0],
        }
    )
    availability = {
        "MODIS": Availability(date(2003, 1, 1)),
        "SNPP": Availability(date(2012, 1, 20)),
        "NOAA20": Availability(date(2018, 4, 1)),
    }

    got = harmonize_daily(groups, availability, {"SNPP": 0.5, "NOAA20": 0.5}).iloc[0]

    assert np.isnan(got.equal_mix_count_1d)
    assert np.isnan(got.viirs_first_count_1d)
    assert got.viirs_first_flag == "no_source"
