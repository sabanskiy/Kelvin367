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
| _none yet_ | | | |

## Data policy

- No access keys, tokens or personal data in the repository (see CONTRIBUTING.md).
- Raw downloads are not committed (`data/` is ignored). Commit only small derived files that we are allowed to redistribute, with their source named here.
- Do not redistribute third-party raw polygons or data whose licence does not allow it.
- Fire detections are not fire reports and not burned area. Say "detections" in the product and in text.
- For areas affected by armed conflict, show only aggregated values (grid cells or area totals), not individual detection points.
