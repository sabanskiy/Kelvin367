import numpy as np
import pandas as pd

from kelvin367_harmonization.calibration import estimate_link


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

