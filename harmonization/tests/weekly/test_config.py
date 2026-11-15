"""The product configuration (src/spacechallenge/config.py) is what the published files and the grids actually use."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

from kelvin367_harmonization.weekly import calendar, config, continuous, firms  # noqa: E402

DATA = ROOT / "app" / "data"


def test_defaults_of_the_package_come_from_the_config():
    import inspect
    assert inspect.signature(continuous.assemble).parameters["split_year"].default == config.SPLIT_YEAR
    assert inspect.signature(continuous.assemble).parameters["profile"].default == config.DEFAULT_PROFILE
    assert inspect.signature(calendar.naive_stitch).parameters["switch"].default == config.NAIVE_CUTOFF
    assert config.DEFAULT_PROFILE in firms.FILTER_PROFILES


def test_areas_are_complete_and_scripts_reuse_them():
    from kelvin367_harmonization.weekly import areas
    assert areas.config.AREAS is config.AREAS
    for key, a in config.AREAS.items():
        assert {"name", "ne", "arch", "api", "bbox"} <= set(a) and len(a["bbox"]) == 4 and a["bbox"][0] < a["bbox"][2] and a["bbox"][1] < a["bbox"][3]
    assert set(config.GRID_COUNTRIES) <= set(config.AREAS)


def test_link_windows_are_ordered_and_consistent():
    for (src, dst), (a, b) in config.LINK_TRAIN.items():
        assert a < b, (src, dst)
    assert config.LINK_TRAIN[("SNPP", "MODIS")][1] < f"{config.SPLIT_YEAR}-01-01"
    specs = config.link_specs()
    assert [(s["source"], s["target"]) for s in specs] == [("SNPP", "MODIS"), ("SNPP", "NOAA20"), ("NOAA20", "NOAA21")]


def test_published_grids_carry_the_configured_windows():
    for grid in ("grid_europe", "grid_africa", "grid_south_america"):
        p = DATA / f"{grid}.meta.json"
        if not p.exists():
            continue
        m = json.loads(p.read_text(encoding="utf-8"))
        want = [s for s in config.link_specs() if s["target"] == "MODIS" or grid == "grid_europe"]
        assert m["links"] == want, grid
        assert m["baseline_years"] == list(config.BASELINE_YEARS) and m["naive_cutoff"] == config.NAIVE_CUTOFF
        assert m["filter_profile"]["name"] == config.DEFAULT_PROFILE
