# Data sources and licenses

The Kelvin367 three-day forecast for central Spain uses NASA FIRMS active-fire detections, NOAA weather forecasts, and environmental features aggregated from satellite products. This document records the sources and reuse terms for the NASA Space Apps Challenge 2026 entry for [Harmonization of MODIS and VIIRS Hot Spots](https://www.spaceappschallenge.org/2026/challenges/modis-and-viirs-hot-spots/).

## Forecast dataset

The historical dataset covers January 2012 through December 2025 on a 16 × 18 grid of 0.25° × 0.25° cells. The grid spans 6°W to 1.5°W and 38°N to 42°N. Time-dependent features are keyed by `issue_utc`, `cell_y`, and `cell_x`. Each forecast is issued at 00:00 UTC and returns a separate score for the issue date and each of the following two UTC dates. Historical coverage varies by source and unavailable features remain missing.

The target is at least one NASA FIRMS `MODIS_SP` active-fire detection by Aqua (`satellite = A`) with `type = 0` in the cell on the target date. FIRMS uses `type = 0` for **presumed vegetation fire**, including wildfires and agricultural burning. A qualifying detection gives the model a positive label (`y = 1`). Verified Aqua SP coverage is required to assign a negative label and unclassified records can leave a cell-day unlabeled. Overpass timing, cloud cover, and sensor sensitivity affect detection. [FIRMS MODIS product and attributes](https://firms2.modaps.eosdis.nasa.gov/content/descriptions/FIRMS_MODIS_Firehotspots.html).

## Source data and reuse terms

| Dataset | Use in the forecast | License or reuse terms |
| --- | --- | --- |
| **NASA FIRMS MODIS Aqua, Collection 6.1** (`MODIS_SP`) | Supplies the active-fire target. The catalogue can contain `MODIS_NRT` records for periods without SP coverage. Target construction uses SP records. | NASA data are freely available for reuse and redistribution under the applicable NASA data policy. Credit NASA FIRMS and identify the platform, product, and collection. [FIRMS archive](https://firms.modaps.eosdis.nasa.gov/download/) · [NASA data-use policy](https://ladsweb.modaps.eosdis.nasa.gov/learn/). |
| **NASA FIRMS VIIRS 375 m** (Suomi-NPP, NOAA-20, NOAA-21) | Supplies past detection counts, fire radiative power (FRP), and neighboring activity. The catalogue records Standard Processing (SP) and Near Real-Time (NRT) provenance. It prefers SP when available. | Freely available NASA FIRMS data. Credit NASA FIRMS, identify the platforms and product modes used, and retain the product provenance when sharing derived tables. [FIRMS Area API](https://firms.modaps.eosdis.nasa.gov/api/area/) · [FIRMS archive](https://firms.modaps.eosdis.nasa.gov/download/) · [NASA data-use policy](https://ladsweb.modaps.eosdis.nasa.gov/learn/). |
| **NOAA/NCEP GFS 0.25°** (`NOAA/GFS0P25`) | Daily maximum temperature, minimum relative humidity, maximum wind speed, and total precipitation for each forecast day. All three horizons use the preceding day's 18:00 UTC run. Also supplies weather inputs for FWI. | Public domain. Credit NOAA/NCEP. [Earth Engine dataset and terms](https://developers.google.com/earth-engine/datasets/catalog/NOAA_GFS0P25). |
| **NASA JPL NASADEM HGT V001** (`NASA/NASADEM_HGT/001`) | Cell-average elevation and slope. | NASA permits use without prior permission under the dataset's published terms. Credit NASA JPL. [Dataset and terms](https://developers.google.com/earth-engine/datasets/catalog/NASA_NASADEM_HGT_001) · [Dataset DOI](https://doi.org/10.5067/MEaSUREs/NASADEM/NASADEM_HGT.001). |
| **Copernicus CORINE Land Cover 2012 and 2018, 100 m** (`COPERNICUS/CORINE/V20/100m`) | Cell fractions for forest, shrubland, natural grassland, and agricultural land. The training workflow selects the snapshot eligible for the forecast issue date. | Copernicus Land Monitoring Service provides full, open, and free access and permits reuse and redistribution with source attribution. Use the credit below for derived land-cover fractions. [CLMS data policy](https://land.copernicus.eu/en/data-policy) · [2012 raster DOI](https://doi.org/10.2909/a84ae124-c5c5-4577-8e10-511bfe55cc0d) · [2018 raster DOI](https://doi.org/10.2909/960998c1-1870-4e82-8051-6485205ebbac). |
| **NASA SMAP L4 SPL4SMGP V008** (`NASA/SMAP/SPL4SMGP/008`) | Lagged daily surface soil moisture and a trailing seven-day mean. | Public-domain data in the Earth Engine catalog. NASA NSIDC DAAC asks users to cite the dataset as a condition of use. [Dataset and terms](https://developers.google.com/earth-engine/datasets/catalog/NASA_SMAP_SPL4SMGP_008) · [NSIDC citation and DOI](https://nsidc.org/data/spl4smgp/versions/8). |
| **MODIS Terra Surface Reflectance MOD09A1.061** (`MODIS/061/MOD09A1`) | Quality-screened eight-day reflectance composites used to calculate NDMI. | NASA LP DAAC permits use and redistribution. Credit the product and collection. [Dataset and terms](https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MOD09A1) · [Dataset DOI](https://doi.org/10.5067/MODIS/MOD09A1.061). |
| **Natural Earth Admin 0 Countries, 1:10m, v5.1.2** | Spain boundary used to filter FIRMS points. | Public domain. Credit Natural Earth in the project submission. [Versioned GeoJSON](https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_10m_admin_0_countries.geojson) · [Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/). |

**FIRMS credit.** Active-fire data provided by NASA's Fire Information for Resource Management System (FIRMS), part of NASA's LANCE capabilities and Earth Science Data and Information System (ESDIS). [NASA FIRMS citation guidance](https://appliedsciences.nasa.gov/sites/default/files/2025-04/FIRMS_Part2_QA.pdf).

**CORINE credit for derived features.** Generated using European Union's Copernicus Land Monitoring Service information. Cite the raster DOI for each snapshot used. [CLMS attribution guidance](https://land.copernicus.eu/en/data-policy).

**Fire Weather Index (FWI).** The project computes FWI from NOAA GFS using `xclim.indices.fire.cffwis_indices`. Cite NOAA/NCEP for the input data and `xclim` for the implementation. The package uses Apache-2.0. The FWI module credits portions adapted from code published under GPLv2. [xclim license](https://github.com/Ouranosinc/xclim/blob/main/LICENSE) · [FWI implementation](https://xclim.readthedocs.io/en/v0.59.1/_modules/xclim/indices/fire/_cffwis.html).

## Google Earth Engine

Google Earth Engine supplies catalog access and geospatial processing for the environmental features. The notebooks use it to aggregate GFS, NASADEM, CORINE, SMAP, and MODIS Terra surface reflectance onto the forecast grid. Section 4.4 of the Earth Engine agreement recognizes separate terms for third-party datasets and gives those terms priority when they conflict with the agreement. Section 2.1 governs eligible use of the noncommercial service and covers use of generated data and figures in research or educational publications. [Google Earth Engine Terms of Service](https://earthengine.google.com/terms/).

A Google Cloud project with the Earth Engine API enabled, Earth Engine registration, and appropriate user permissions is required to rerun the Earth Engine steps. Google requires eligibility verification for unpaid noncommercial access. Commercial use requires the appropriate commercial configuration and is governed by Google Cloud terms. The open-source Python client (`earthengine-api`) uses Apache-2.0. [Earth Engine access](https://developers.google.com/earth-engine/guides/access) · [Google Cloud service terms](https://cloud.google.com/terms/service-terms) · [Python client license](https://github.com/google/earthengine-api/blob/master/LICENSE).

## Reproducing the data

| Notebook | Inputs and outputs |
| --- | --- |
| `Spain_FIRMS_2012_2025_Colab.ipynb` | Uses a FIRMS MAP_KEY to fetch records and writes `detections/detections_spain.parquet`, `detections/firms_coverage_by_year.csv`, and `detections/firms_download_plan.csv`. Keep the catalogue and coverage report from the same run. [Request a FIRMS MAP_KEY](https://firms.modaps.eosdis.nasa.gov/api/map_key/). |
| `Spain_Environmental_Features_2012_2025_Colab.ipynb` | Uses Earth Engine and writes per-source features and `features/environmental_features.parquet`. The GFS horizon tables and FWI table are in `features/gfs_physical_qc/`. |
| `Spain_VIIRS_Aqua_3Day_CatBoost_2012_2025.ipynb` | Reads the prepared tables and coverage report from the same Google Drive folder. Builds labels and separate training inputs for each forecast horizon. |

The default output root in Colab is `MyDrive/spain_firms_2012_2025/`. Keep API keys in Colab Secrets or enter them at the notebook prompt. When publishing derived tables or figures, preserve the dataset names, versions, and credits above. Include all sources and tools used in the project submission. [Space Apps participant terms](https://www.spaceappschallenge.org/legal/).

## Downloaded data

https://drive.google.com/drive/folders/1yThW8WKW-unT0Ed6xx5Rpb5y3ZDDq7D2?usp=sharing

