import numpy as np
import pandas as pd

from kelvin367_harmonization.calibration import compose_factor, estimate_link


def test_link_uses_geometric_weekly_ratio_separately_for_day_and_night():
    weekly = pd.DataFrame(
        {
            "source_day": [10, 20, 40],
            "target_day": [5, 10, 20],
            "source_night": [10, 20, 40],
            "target_night": [2, 4, 8],
        }
    )

    got = estimate_link(weekly, min_count=1)

    assert np.isclose(got["k_day"], 0.5)
    assert np.isclose(got["k_night"], 0.2)
    assert got["estimator"] == "geometric_mean_of_weekly_ratios"


def test_noaa20_to_modis_factor_is_composed_through_snpp():
    snpp_to_modis = {"k_day": 0.5, "k_night": 0.2}
    snpp_to_noaa20 = {"k_day": 1.0, "k_night": 0.8}

    assert np.isclose(compose_factor(snpp_to_modis, snpp_to_noaa20, "D"), 0.5)
    assert np.isclose(compose_factor(snpp_to_modis, snpp_to_noaa20, "N"), 0.25)
