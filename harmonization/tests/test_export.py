import json

import pandas as pd

from kelvin367_harmonization.export import export_harmonized


def test_export_writes_both_policies_and_declares_viirs_first_canonical(tmp_path):
    source = tmp_path / "groups.csv"
    pd.DataFrame(
        {
            "date": ["2020-06-09"],
            "cell_iy": [160],
            "cell_ix": [-15],
            "MODIS": [3.0],
            "SNPP": [0.5],
            "NOAA20": [0.0],
        }
    ).to_csv(source, index=False)

    metadata = export_harmonized(source, tmp_path / "out.parquet", tmp_path / "metadata.json")

    assert metadata["canonical_harmonization"] == "viirs_first_count_1d"
    assert metadata["available_policies"] == ["equal_mix_count_1d", "viirs_first_count_1d"]
    assert metadata["source"]["sha256"]
    assert metadata["output"]["sha256"]
    saved = json.loads((tmp_path / "metadata.json").read_text())
    assert saved == metadata
    assert set(pd.read_parquet(tmp_path / "out.parquet")) >= {
        "equal_mix_count_1d",
        "viirs_first_count_1d",
        "viirs_first_flag",
    }
