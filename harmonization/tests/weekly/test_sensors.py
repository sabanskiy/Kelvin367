from datetime import date

from kelvin367_harmonization.weekly import sensors


def test_known_gaps_lookup():
    assert sensors.in_known_gap("SNPP", date(2026, 5, 15))
    assert not sensors.in_known_gap("NOAA20", date(2026, 5, 15))
    assert sum(g.days for g in sensors.KNOWN_GAPS if g.platform == "SNPP" and g.start.year == 2026) == 44


def test_overlap_chain():
    assert sensors.overlap("SNPP", "NOAA20")[0] == date(2018, 4, 1)
    assert sensors.overlap("NOAA20", "NOAA21")[0] == date(2024, 1, 17)
