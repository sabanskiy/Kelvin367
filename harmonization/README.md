# Kelvin367 daily harmonization

This standalone Python package publishes the two daily source-selection policies evaluated by Kelvin367. Both consume daily cell counts that have already been calibrated to the MODIS-equivalent scale.

| Output | Policy |
|---|---|
| `equal_mix_count_1d` | Mean of all available calibrated MODIS, S-NPP and NOAA-20 groups. |
| `viirs_first_count_1d` | Weighted S-NPP/NOAA-20 estimate; MODIS is used only before VIIRS or as fallback during a VIIRS outage. |

`viirs_first_count_1d` is the canonical output. Equal-mix remains available for transparent method comparison. Forecasting is a downstream use and is not part of the harmonization validation.

## Input contract

The exporter accepts CSV or Parquet with one row per `date`, `cell_iy`, `cell_ix` and these calibrated group columns:

- `MODIS`: calibrated Terra/Aqua daily total;
- `SNPP`: S-NPP daily count converted to the MODIS scale;
- `NOAA20`: NOAA-20 daily count converted to the MODIS scale.

An available sensor with no detections is represented by `0`. Sensor outages are handled by the availability calendar, not by changing observed zeros to missing values. Day/night link factors can be estimated with `kelvin367_harmonization.calibration.estimate_link`; it uses the geometric mean of valid weekly target/source ratios.

## Run the sample

```bash
cd harmonization
python -m pip install -e '.[dev]'
kelvin367-harmonize sample/calibrated_daily_groups.csv output/harmonized_daily.parquet \
  --metadata output/metadata.json
pytest
```

The complete Spain Parquet is intentionally not committed. Publish it as a GitHub Release asset and record its SHA-256 from the generated metadata. Do not commit FIRMS credentials, Earthdata tokens, `.env` files, or raw downloads.

## Provenance

The policy semantics are ported from the team's `spacechallenge` pipeline. VIIRS-first is the source-selection policy proposed by Andriy; calibration links, masks and export QA remain separate pipeline concerns. Project code is Apache-2.0; NASA FIRMS data retain their own terms described in the repository `DATA.md`.
