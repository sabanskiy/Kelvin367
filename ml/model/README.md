# Wildfire detection forecast for central Spain (CatBoost)

Daily fire-detection probability for each 0.25° × 0.25° cell (16 × 18 grid = 288 cells), **Day 1–3** horizon, issued at 00:00 UTC.
Labels come from NASA FIRMS detections. Runs in Google Colab + Google Drive.

## Notebooks

| Notebook | Purpose |
|---|---|
| `Spain_NOAA20_NOSATS_3Day_CatBoost_2018_2025` | **Main training.** 3 models (Day 1/2/3), NOAA-20 target. No fire-derived features (FIRMS is used for labels only). Train 2012–06.2024, val 07–12.2024, test 2025 |
| **`Spain_NOAA20_3Day_Grid_Predict_Colab`** | **Inference.** Loads the models saved by the notebook above and produces a live forecast (see below) |
| `Spain_Raw_VIIRS_Aqua_CatBoost_Comparison_2012_2024` | Experiment: Aqua target (`MODIS_SP`, type=0), fire-history features from raw VIIRS (counts/FRP). Test 2024 |
| `Spain_Harmonized_Aqua_CatBoost_Comparison_2012_2024` | Same setup, but the raw VIIRS block is replaced by a harmonized daily signal. Compared against Raw |

Both *Comparison* notebooks also compare NOAA-20 vs Aqua targets on Day 1 (shared rows, 2018+).

Main model results (test 2025, positive rate ≈ 1.3%):

| Lead | AP | F1 |
|---|---|---|
| Day 1 | 0.246 | 0.343 |
| Day 2 | 0.241 | 0.338 |
| Day 3 | 0.234 | 0.340 |

---

## Predict notebook (`Spain_NOAA20_3Day_Grid_Predict_Colab`)

**What it does:** for a given issue date, computes the probability of ≥1 NOAA-20 detection in every cell for the next 3 days (UTC). Default is `2026-11-15`, 288 cells, 15–17 November.

### Requirements
- Drive: `spain_firms_2012_2025/` containing
  - `model_runs/noaa20_environment_catboost_3day/<run>/` — `catboost_day{1,2,3}.cbm` + `model_manifest.json`
  - `features/` — `elevation_by_cell.parquet`, `corine_*_by_cell.parquet`
- An Earth Engine project (`EE_PROJECT` in the config cell or in Colab Secrets)
- Optional: `spain.json` with history; the forecast is added under the `forecast` key

### Configuration (first cell)
- `ISSUE_DATE` — issue date (cannot be in the future)
- `REQUESTED_DAYS` — requested days; the models actually support at most **3**
- `RUN_DIR` — `None` = latest complete saved model run
- `HISTORY_JSON`, `OUTPUT_PATH` — optional

### Feature sources
- **GFS** (Earth Engine) — forecast from the previous day's 18:00 UTC cycle: Tmax, RHmin, wind, precipitation for Day 1–3
- **SMAP** — surface soil moisture (8-day lag, 7-day mean)
- **MODIS Terra NDMI** — vegetation moisture (11-day lag, fallback up to 24 days)
- **FWI** — computed with `xclim` from GFS (120-day warm-up)
- **Static** — elevation, slope, CORINE land cover (from Drive)
- Plus location and seasonality, trailing windows, SMAP/NDMI changes, observation ages

Feature names and order are validated against `model_manifest.json`; a mismatch raises an error.

### API
```python
forecast_grid("2026-11-15", days=3)                                  # whole grid
predict("2026-11-15", latitude=40.4168, longitude=-3.7038, days=3)   # single cell
```
- `series.noaa20_detection_probability[day][cell]` — probability, 0–1
- `null` = no GFS data for that cell/horizon
- Cell bounds: west/south inclusive, east/north exclusive

### Output
`forecast_runs/noaa20_environment_catboost_3day/<date>/spain_forecast.json` on Drive.
The original `spain.json` is never overwritten.

### Notes
- This is the **probability of a satellite detection**, not a guarantee of fire; it depends on overpass timing, clouds and sensor sensitivity
- If SMAP/NDMI/FWI are unavailable, the forecast still runs but with `NaN` in those features (see `warnings` and `missing_model_features`)
- Live FWI can differ slightly from the training FWI (different warm-up)

---

## Workflow
1. Data preparation (FIRMS + environmental features) → Drive
2. `NOSATS_3Day_CatBoost` → train and save models
3. `Grid_Predict_Colab` → daily forecast
4. Comparison notebooks are standalone experiments, not needed for forecasting
