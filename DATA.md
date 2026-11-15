# Data sources, licences and data policy

Every source used by the project must be freely and publicly available without restriction, or available under an OSI-approved or equivalent open licence, and must be cited here. A source whose terms forbid redistribution or restrict use is not used in the solution.

## NASA FIRMS (main source)

- Products: MODIS Collection 6.1 active fires (Terra, Aqua), VIIRS 375 m active fires (S-NPP, NOAA-20, NOAA-21). Source: https://www.earthdata.nasa.gov/data/tools/firms
- Terms: NASA data are openly available. When FIRMS data are provided to a third party, the acknowledgement below is required.
- S-NPP delivery of new data ceased on 2026-11-02 13:00 UTC (the archive remains available); NOAA-20 and NOAA-21 continue.

> We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA's Land, Atmosphere Near real-time Capability for Earth observations (LANCE) (https://earthdata.nasa.gov/lance) and NASA's Earth Science Data and Information System (ESDIS). The data are provided "as is"; users bear all responsibility for their use.

The acknowledgement must appear in the application, in this repository's README, and in any dataset or submission text that redistributes FIRMS data.

## Other sources

Add a row **before** the source is used. Check the licence yourself and write down the link to the terms.

| Source | What for | Licence and link | Cited in the submission |
|---|---|---|---|
| Natural Earth Admin 0 – Countries 1:10m, Ukraine point of view (`ne_10m_admin_0_countries_ukr`) | Country boundaries on the map and for statistics (`countries.json`); country masks of the History data (spacechallenge pipeline). Crimea and all occupied territories are part of Ukraine. | Public domain: https://www.naturalearthdata.com/about/terms-of-use/ | Yes |
| NOAA/NCEP GFS 0.25° (`NOAA/GFS0P25`, via Google Earth Engine) | Weather inputs (Tmax, RHmin, wind, precipitation) and Fire Weather Index of the team's 3-day outlook model (`ml/`), shown in the Forecast tab (`wwwroot/data/outlook/`) | Public domain; credit NOAA/NCEP: https://developers.google.com/earth-engine/datasets/catalog/NOAA_GFS0P25 | Yes |
| NASA JPL NASADEM HGT V001 | Cell elevation and slope for the outlook model | NASA terms, credit NASA JPL: https://developers.google.com/earth-engine/datasets/catalog/NASA_NASADEM_HGT_001 · https://doi.org/10.5067/MEaSUREs/NASADEM/NASADEM_HGT.001 | Yes |
| Copernicus CORINE Land Cover 2012 and 2018, 100 m | Land-cover fractions of each cell for the outlook model | Free reuse with attribution ("Generated using European Union's Copernicus Land Monitoring Service information"): https://land.copernicus.eu/en/data-policy | Yes |
| NASA SMAP L4 SPL4SMGP V008 | Surface soil moisture for the outlook model | Public domain; cite the dataset (NSIDC): https://nsidc.org/data/spl4smgp/versions/8 | Yes |
| MODIS Terra Surface Reflectance MOD09A1.061 | NDMI (vegetation moisture) for the outlook model | NASA LP DAAC, use and redistribution allowed with credit: https://doi.org/10.5067/MODIS/MOD09A1.061 | Yes |
| xclim (Python library) | Computes the Fire Weather Index for the outlook model (notebooks only, not in the app) | Apache-2.0 (FWI module credits code adapted from GPLv2 sources): https://github.com/Ouranosinc/xclim/blob/main/LICENSE | Yes |
| Google Earth Engine | Processing service used by the outlook notebooks to aggregate the inputs above | Earth Engine Terms of Service (non-commercial use; dataset terms take priority): https://earthengine.google.com/terms/ | Yes |

## Data policy

- No access keys, tokens or personal data in the repository (see CONTRIBUTING.md).
- Raw downloads are not committed (`data/` is ignored). Commit only small derived files that we are allowed to redistribute, with their source named here.
- Do not redistribute third-party raw polygons or data whose licence does not allow it.
- Fire detections are not fire reports and not burned area. Say "detections" in the product and in text.
- For areas affected by armed conflict, show only aggregated values (grid cells or area totals), not individual detection points.
