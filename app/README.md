# Hot Spot Explorer — MODIS / VIIRS harmonization (NASA Space Apps 2026)

Web map for the challenge [*Harmonization of MODIS and VIIRS Hot Spots*](https://www.spaceappschallenge.org/2026/challenges/modis-and-viirs-hot-spots/).
It shows NASA FIRMS active-fire detections, and the team's harmonized data can be added as extra layers.
You can select a rectangle or a country to get statistics, including a VIIRS-vs-MODIS comparison.

- **Backend:** ASP.NET Core MVC + API controllers on .NET 10. It proxies and caches NASA FIRMS.
- **Frontend:** vanilla JS (ES modules, no build step), [Leaflet](https://leafletjs.com) 1.9.4, and [Leaflet-Geoman](https://geoman.io) for drawing rectangles. OpenStreetMap is the base map.

## Run

```powershell
# 1. FIRMS MAP_KEY (free: https://firms.modaps.eosdis.nasa.gov/api/map_key/) — stored outside the repo
cd src/FireMap.Web
dotnet user-secrets set Firms:MapKey <your-key>

# 2. Start
cd ../..
dotnet run --project src/FireMap.Web --launch-profile http   # → http://localhost:5032
dotnet test                                                    # unit tests
```

Without a key, the app runs in **sample mode**: real FIRMS extracts for Europe (Oct/Nov 2026) from `src/FireMap.Web/Data/sample/`.
User-secrets are only loaded in the Development environment. For other environments, set `Firms__MapKey` as an environment variable.

## Deploy to Azure

The app runs on **Azure App Service (Linux, .NET 10 LTS)**. Every push to `main` is built, tested and deployed by
[`.github/workflows/azure-webapp.yml`](.github/workflows/azure-webapp.yml).

| Resource | Value |
|---|---|
| Web app | `kelvin-firemap` → https://kelvin-firemap-a4gne7c7gueudeak.westeurope-01.azurewebsites.net |
| Plan / region | `plan-kelvin`, F1 Free, West Europe (resource group `rg-kelvin`) |
| GitHub | variable `AZURE_WEBAPP_NAME`, secret `AZURE_WEBAPP_PUBLISH_PROFILE` |

App settings in Azure (not in this repo):
- `Firms__MapKey` = the FIRMS key.
- `Firms__CacheDirectory` = `/home/data/firms-cache`. `/home` is persistent storage; outside `wwwroot`, so a deploy doesn't wipe the cache.

**F1 limits:** 60 CPU-minutes a day, and the app sleeps when idle. Before a demo, scale up:

```powershell
az appservice plan update -n plan-kelvin -g rg-kelvin --sku B1
az webapp config set -n kelvin-firemap -g rg-kelvin --always-on true
```

## API

| Endpoint | Description |
|---|---|
| `GET /api/config` | Grid and limit settings, mode (`live`/`sample`), and today's UTC date |
| `GET /api/layers` | All layers, with colour and data coverage (`minDate`/`maxDate`) |
| `GET /api/hotspots?layer=viirs-noaa20&bbox=w,s,e,n&from=2026-11-01&to=2026-11-12` | GeoJSON points. Use `&country=UKR` instead of `bbox` for a country. |
| `POST /api/stats` | `{ "layers": ["modis","viirs-noaa20"], "country": "UKR" \| "bbox": [w,s,e,n], "from": "...", "to": "..." }` → count, FRP sum/mean/median/max, day/night, confidence, per-day series, VIIRS÷MODIS ratios |
| `GET /api/status` | NASA quota usage and cache counters |
| `DELETE /api/cache?source=MODIS_NRT&olderThan=2026-11-10` | Development only: purge cached tiles |

The maximum time range is 31 days (`Api:MaxRangeDays`). A map response holds at most 50,000 points; when there are more, the strongest by FRP are kept and `truncated: true` is set.

## Adding the harmonized layer

1. Map the harmonized output onto `Models/Hotspot.cs`. Use whatever fields apply, and add new fields if needed.
2. Implement `Services/IHotspotProvider.cs`:
   ```csharp
   public sealed class HarmonizedHotspotProvider : IHotspotProvider
   {
       public LayerDescriptor Layer { get; } = new("harmonized", "Harmonized (MODIS-equivalent)", "Team",
           "#00b4d8", "VIIRS→MODIS", 1000, "Our harmonized product", DefaultVisible: true);
       public Task<DateRange?> GetCoverageAsync(CancellationToken ct) => ...;
       public Task<HotspotBatch> GetAsync(HotspotRequest r, CancellationToken ct) => ...; // filter by r.Area envelope + dates
   }
   ```
3. Register it in `Program.cs`: `builder.Services.AddSingleton<IHotspotProvider, HarmonizedHotspotProvider>();`

That's all. The layer appears in the sidebar (from `/api/layers`), on the map, and in the statistics. Country clipping and exact filtering are shared code (`HotspotQueryService`).
Optional: a different marker look via `LAYER_STYLES` in `wwwroot/js/layers.js`. Extra metrics go in `Services/StatsService.cs`.

## NASA FIRMS quota & caching

These facts were measured against the live API on 2026-11-13:
- The quota is **5,000 transactions per 10 minutes** per key.
- **An area request costs 2 transactions per day requested.** Bbox size and number of rows don't change the cost.
- `DAY_RANGE` accepts 1–5 days; 6 or more returns HTTP 400. A request covers `date` … `date + days − 1`.

The cache is designed around these facts:
- **30° tiles** (72 for the whole world). The area is free, so large tiles keep the number of requests low.
- **1-day chunks.** No request pays for days the user didn't ask for, and every day is cached separately.
- **HybridCache:** memory (L1) plus a gzip file cache on disk (L2) at `src/FireMap.Web/App_Data/firms-cache/`.
  - The disk cache survives restarts. Zip the folder to give a teammate a warm cache.
  - Concurrent identical requests share one NASA call.
- **TTL:** archive (SP) data and NRT data older than 2 days are cached for 30 days. Recent NRT is cached for 20 minutes.
- **Quota guard:** above 4,000 used transactions (`Firms:SoftLimit`), only cached data is served, and the API answers `partial: true`.
  - The local count is re-synced with FIRMS' own `mapkey_status` every 2 minutes.
  - An HTTP 429/403 from FIRMS pauses upstream calls for 10 minutes.

Typical costs (cold cache): a country-sized view for 2 days with 2 layers costs about 16 transactions. Brazil statistics for 3 days with 2 layers cost about 58.

## Country boundaries

`wwwroot/data/countries.json` comes from the Natural Earth 1:10m **Ukraine point-of-view** dataset
(`ne_10m_admin_0_countries_ukr`), so **Crimea and the other occupied territories are part of Ukraine**.
This applies on the map and in every country statistic, because the frontend and backend use the same file.
To regenerate it (e.g. a different simplification), run:

```powershell
# download https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries_ukr.geojson first
dotnet run tools/SlimCountries.cs -- ne_10m_admin_0_countries_ukr.geojson src/FireMap.Web/wwwroot/data/countries.json 0.02
```

The script prints a check that Simferopol, Sevastopol and Kerch fall inside `UKR`.

## Layout

```
src/FireMap.Web/
  Controllers/Api/        Layers, Hotspots, Stats, Status
  Services/
    IHotspotProvider.cs   layer contract + registry
    HotspotQueryService   validation + exact area/date filtering
    StatsService          aggregations, sensor comparison
    Firms/                FIRMS client, tiling, time planning, CSV parser, quota guard, providers
    Caching/              FileDistributedCache (L2), metrics
    Geo/                  country boundaries (Natural Earth 1:10m, Ukraine POV), area resolver, spherical area
  wwwroot/js/             app.js · api.js · map.js · layers.js · selection.js · panel.js · geo.js
  wwwroot/data/countries.json
tests/FireMap.Tests/      planner, tiling, CSV parser, caching, quota guard
```
