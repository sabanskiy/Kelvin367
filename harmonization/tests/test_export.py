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
    assert metadata["source"]["path"] == "groups.csv"
    assert metadata["generator"]["package"] == "kelvin367-harmonization"
    assert metadata["generator"]["commit"]
    assert metadata["versions"]["pandas"]
    assert metadata["availability"]["NOAA20"]["gaps"]
    assert metadata["weight_provenance"]["train_end"] == "2020-12-31"
    saved = json.loads((tmp_path / "metadata.json").read_text())
    assert saved == metadata
    assert set(pd.read_parquet(tmp_path / "out.parquet")) >= {
        "equal_mix_count_1d",
        "viirs_first_count_1d",
        "viirs_first_flag",
    }


def test_default_export_renormalizes_to_snpp_during_real_noaa20_gap(tmp_path):
    source = tmp_path / "groups.csv"
    pd.DataFrame(
        {
            "date": ["2023-07-20"],
            "cell_iy": [160],
            "cell_ix": [-15],
            "MODIS": [4.0],
            "SNPP": [2.0],
            "NOAA20": [0.0],
        }
    ).to_csv(source, index=False)

    export_harmonized(source, tmp_path / "out.parquet", tmp_path / "metadata.json")
    got = pd.read_parquet(tmp_path / "out.parquet").iloc[0]

    assert got.viirs_first_count_1d == 2.0
    assert got.viirs_first_source == 2
    assert got.viirs_first_flag == "viirs"
