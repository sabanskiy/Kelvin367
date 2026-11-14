# Kelvin367

One consistent record of burning, from MODIS to VIIRS.

Kelvin367 is a prototype built for the **NASA International Space Apps Challenge 2026**, challenge *Harmonization of MODIS and VIIRS Hot Spots*. It is an independent project and is **not endorsed by NASA**.

Active-fire detections come from different satellite sensors (MODIS, then VIIRS on S-NPP, NOAA-20 and NOAA-21). When the sensors change, raw counts jump even if real burning did not. The project converts detections to one comparable scale (MODIS-equivalent) with an uncertainty band, and shows the result on a map and in a weekly burning calendar for a chosen area and period. A second function, a forecast for a chosen future week on the same map, is planned.

> Status: work in progress during the hackathon (14–15 November 2026).

## Repository layout

| Path | Purpose |
|---|---|
| `LICENSE`, `NOTICE` | Apache License 2.0 |
| `DATA.md` | data sources, licences, required acknowledgement, data policy |
| `CONTRIBUTING.md` | how the team works in this repository |
| `docs/` | project documentation |
| `design/fire-history-map/` | UI design prototype of the History screen (see its README) |
| `.github/` | pull request and issue templates, repository checks |

## Licence

Everything created for the hackathon in this repository is released under the [Apache License 2.0](LICENSE), an OSI-approved open-source licence. Third-party material keeps its own licence; see [DATA.md](DATA.md).

## Data acknowledgement

We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA's Land, Atmosphere Near real-time Capability for Earth observations (LANCE) (https://earthdata.nasa.gov/lance) and NASA's Earth Science Data and Information System (ESDIS). The data are provided "as is"; users bear all responsibility for their use.
