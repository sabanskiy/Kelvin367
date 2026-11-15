<!-- AI-assisted: generated with Claude based on team's design. -->
# Wildfire detection forecast for Spain (CatBoost)

Daily probability of a NOAA-20 fire detection for each 0.25° × 0.25° cell over Spain, issued at 00:00 UTC, up to **6 days** ahead.
Labels come from NASA FIRMS detections. Runs in Google Colab + Google Drive.

## Notebooks

| Notebook | Purpose |
|---|---|
| `Spain_NOAA20_NOSATS_3Day_CatBoost_2018_2025` | **Training.** 3 models (Day 1/2/3) on the central Spain grid (16 × 18 = 288 cells), NOAA-20 target. No fire-derived features (FIRMS is used for labels only). Train 2012–06.2024, val 07–12.2024, test 2025 |
| **`Spain_NOAA20_6Day_Kelvin367_Predict_Colab`** | **Inference.** Loads the saved models and forecasts all cells intersecting Spain, 6 days ahead (see below) |

Training results (test 2025, positive rate ≈ 1.3%):

| Lead | AP | F1 |
|---|---|---|
| Day 1 | 0.246 | 0.343 |
| Day 2 | 0.241 | 0.338 |
| Day 3 | 0.234 | 0.340 |

---

## Predict notebook (`Spain_NOAA20_6Day_Kelvin367_Predict_Colab`)

**What it does:** for an issue date, computes the probability of ≥1 NOAA-20 detection in every Spain cell for 6 UTC days. Default is `2026-11-15`, giving 15–20 November.

### Read this first: how far to trust the scores
| Scope | Status |
|---|---|
| Days 1–3, cells inside the training grid | **Validated** (trained horizon) |
| Days 4–6 | **Experimental.** The Day 1–3 models are reused with later GFS weather; accuracy at these horizons is not evaluated |
| Cells outside the training grid (`outside_training_grid: true`) | **Not validated geographically** |

### Spain grid
- Cells are the original 0.25° grid, kept if they overlap the Spain boundary by any area (coastal and border cells are full rectangles)
- Boundary: the ESP feature from Kelvin367 `app/src/FireMap.Web/wwwroot/data/countries.json` (bundled in the notebook; set `COUNTRIES_JSON` to use a newer copy). The file's SHA-256 is stored in the output

### Requirements
- Drive: `spain_firms_2012_2025/` with
  - `model_runs/noaa20_environment_catboost_3day/<run>/` — `catboost_day{1,2,3}.cbm` + `model_manifest.json`
  - `features/` — `elevation_by_cell.parquet`, `corine_*_by_cell.parquet` (reused where available; NASADEM and CORINE are downloaded for the remaining cells)
- Earth Engine project: set `EE_PROJECT` in the config cell or in Colab Secrets (never commit it)
- Optional: `spain.json` (weekly history); the forecast is added under `forecast`

### Configuration (first cell)
- `ISSUE_DATE` — issue date (not in the future)
- `REQUESTED_DAYS` — 1–6 (default 6; models are trained for 3)
- `RUN_DIR` — `None` = latest complete model run
- `COUNTRIES_JSON`, `HISTORY_JSON`, `OUTPUT_PATH` — optional

### Feature sources
- **GFS** (Earth Engine) — previous day's 18:00 UTC cycle: Tmax, RHmin, wind, precipitation. All 6 days use this same cycle
- **SMAP** soil moisture · **MODIS Terra NDMI** · **FWI** (via `xclim`, 120-day warm-up)
- **Static** — NASADEM elevation/slope, CORINE land cover
- Plus location, seasonality, trailing windows and observation ages

Feature names and order are validated against `model_manifest.json`.

### API
```python
forecast_grid("2026-11-15", days=6)                                  # whole grid
predict("2026-11-15", latitude=40.4168, longitude=-3.7038, days=6)   # one point inside Spain
```
- `series.noaa20_detection_probability[day][cell]` — probability, 0–1
- `quality.method_by_day` — `trained_horizon` or `experimental` per day
- `quality.model_horizon_by_day` — which trained model (1–3) scored each day
- `null` = no GFS data for that cell/horizon
- Cell bounds: west/south inclusive, east/north exclusive

### Output
`forecast_runs/noaa20_environment_catboost_spain/<date>/spain_forecast.json` on Drive.
The original `spain.json` is never overwritten.

### Notes
- This is the **probability of a satellite detection**, not a guarantee of fire; overpass timing, clouds and sensor sensitivity affect it
- If SMAP/NDMI/FWI are unavailable, the forecast still runs with `NaN` in those features (see `warnings`, `missing_model_features`)
- Live FWI can differ slightly from training FWI (different warm-up)

---

## Workflow
1. Data preparation (FIRMS + environmental features) → Drive
2. `NOSATS_3Day_CatBoost` → train and save models
3. `6Day_Kelvin367_Predict_Colab` → forecast for Spain
