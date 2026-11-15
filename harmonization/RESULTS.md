# Strategy 1 (weekly calibration chain): where each result comes from

Strategy 1 converts weekly detection counts of VIIRS S-NPP, NOAA-20 and NOAA-21 to the MODIS scale through a chain of links
(NOAA-21 to NOAA-20 to S-NPP to MODIS), separately for day and night, with an 80% uncertainty interval.
Code: `src/kelvin367_harmonization/weekly/`; scripts: `scripts/weekly/`; tests: `tests/weekly/`.

Raw data are not committed (`data/` is ignored). Download them with the scripts in `scripts/weekly/` (FIRMS access key only through the
`FIRMS_MAP_KEY` environment variable) and keep the layout `harmonization/data/raw/...`.

| Result | Value | Script | Data needed | Status |
|---|---|---|---|---|
| 80% interval: half-width multiplier chosen on 2020-2021 | 0.78 | `eval_interval_calibration.py` | FIRMS yearly country archives, 2003-2024 | script included |
| Coverage of that interval on 2022 onward | 0.78 pooled, 0.66-0.89 by area | `eval_interval_calibration.py` | same | script included |
| S-NPP to MODIS day coefficient across nine areas | 0.257 (Indonesia) to 0.543 (Italy) | `eval_regions.py` | FIRMS country archives (Europe, Chile, Canada, Indonesia, South Africa) | script included; the event-detection part also reads `known-events-regions.csv`, which is not included |
| Same, night | 0.076 to 0.246 | `eval_regions.py` | same | script included |
| Spread between areas (max / min) | 2.1x day, 3.2x night | derived from the two rows above | - | arithmetic |
| Step at the 2012 sensor change against GFED5 (1.0 = no step) | harmonized 0.91 (0.80-0.95), naive splice 0.27 (0.24-0.29), MODIS control 1.07 | `eval_transition_gfed5.py` | GFED5 `BA.zip` (265 MB, Zenodo 10.5281/zenodo.7668424, `download_gfed5.py`) | script included |
| Same against MCD64A1 | harmonized 0.96 (0.83-1.30), naive splice 0.30 | `eval_burnt_area_2012.py` | MCD64A1 burned-pixel extracts (about 7.3 GB to download) | script included; extraction step not included, result documented only |
| Disagreement between sensors before and after correction | x2.4-3.8 to x1.25-1.46 on held-out 2022-2024 | **no script established** | - | **not reproducible from this repository; do not cite as reproduced** |

Known limits: the coefficient depends on the area (a single coefficient is off by x0.64 to x1.80 between regions of one country);
night coefficients include static heat sources; the 80% interval covers 78%, not 80%.
