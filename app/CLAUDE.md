# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

NASA Space Apps 2026 — "Harmonization of MODIS and VIIRS Hot Spots". This repo is the **web app** (Kelvin367), with two tabs:
- **History:** weekly calendar of harmonized MODIS/VIIRS counts for preset areas or a drawn rectangle, with a 0.5° cell map. The data comes from the team's spacechallenge pipeline.
- **Forecast:** live NASA FIRMS detections. Users filter by rectangle or country, get statistics, play a day-by-day timeline, and compare two periods. The team's Outlook model will plug in here later.

The backend is ASP.NET Core API controllers on **.NET 10**. The frontend is a **React 19 + TypeScript + Vite + Tailwind 4 SPA** in `src/FireMap.Web/ClientApp`, built into `wwwroot/` and served by the same app. Maps use Leaflet 1.9.4 + Leaflet-Geoman 2.20.4 (npm) with an OSM base map. The design source is the Figma Make export in `Kelvin367-main/design/fire-history-map`.

## Commands

```powershell
dotnet build                                                   # whole solution (Kelvin.slnx)
dotnet test                                                    # xUnit, tests/FireMap.Tests
dotnet test --filter "FullyQualifiedName~TimeRangePlannerTests" # one class
dotnet test --filter "FullyQualifiedName~GridTilingTests.World_has_648_tiles_of_10_degrees"  # one test
dotnet run --project src/FireMap.Web --launch-profile http     # http://localhost:5032 (Development)
cd src/FireMap.Web; dotnet user-secrets set Firms:MapKey <key> # FIRMS key (Development only)
dotnet publish src/FireMap.Web -c Release -o <dir>             # also runs npm ci + npm run build (needs Node 22.12+)

cd src/FireMap.Web/ClientApp
npm ci                     # once
npm run dev                # Vite on http://localhost:5173, proxies /api and /data to :5032 (run the backend too)
npm run build              # typecheck + build into ../wwwroot (index.html, assets/)
npm run typecheck
npm test                   # Vitest (src/**/*.test.ts)
npx vitest run src/lib/chain.test.ts
```

- **Mode:** without `Firms:MapKey` the app runs in **sample mode**, serving real FIRMS extracts from `src/FireMap.Web/Data/sample/{layerId}.csv` (Europe, Oct/Nov 2026).
- **User-secrets load only in Development.** `dotnet run` without the launch profile runs as Production, which silently falls back to sample mode.
- **The SPA is a build output.** `wwwroot/index.html` and `wwwroot/assets/` are generated and git-ignored.
  - Plain `dotnet build`/`dotnet run` do not run npm: use `npm run dev`, or `npm run build` once.
  - `dotnet publish` builds it through the `PublishClientApp` target. `-p:SkipClientBuild=true` skips that step.
- **Routing:** `Program.cs` maps the API, returns 404 for unknown `/api/*`, and falls back to `index.html` for everything else.
- **Run Vitest from PowerShell.** Under Git Bash, Vitest 5 fails every file with `Cannot read properties of undefined (reading 'config')`.
- **Browser testing:** drive headless Edge (`msedge --headless=new --remote-debugging-port=…`) over CDP from a .NET file-based script (`dotnet run Script.cs`).
  - Headless Edge reports `navigator.language = "uk"` here, so the UI auto-selects Ukrainian.
  - Pick the CDP target by URL; Edge opens extra page targets.
  - File-based .NET scripts need `#:property JsonSerializerIsReflectionEnabledByDefault=true` to use System.Text.Json.

## Backend architecture (src/FireMap.Web)

Request path:
`Controllers/Api/*` → `HotspotQueryService` (validates the range, applies exact area/date filtering) → `HotspotProviderRegistry` → `IHotspotProvider` (one per map layer).

- **Layers are providers.** `IHotspotProvider` (`Services/IHotspotProvider.cs`) is the extension point. Each provider is registered in `Program.cs`, and `/api/layers` lists them all, so the frontend needs no change to show a new layer.
  - Providers may return points *outside* the requested area or dates (whole cache tiles). Exact filtering happens centrally in `HotspotQueryService` with `QueryArea.Contains`.
  - Harmonized data from the team goes in as a new provider. Its records map onto `Models/Hotspot.cs`.
- **FIRMS provider pipeline** (`Services/Firms/`):
  - `FirmsHotspotProvider` asks `TimeRangePlanner` for fetch plans: 1-day chunks aligned to a 2000-01-01 epoch, using the SP (archive) source where available and NRT otherwise, according to `FirmsAvailabilityService`.
  - It asks `GridTiling` for 30° tiles. For countries, only tiles that intersect the polygon are used.
  - It fetches each plan × tile through `CachedFirmsClient` → HybridCache (L1 memory, L2 `Services/Caching/FileDistributedCache` writing gzip files in `App_Data/firms-cache/`) → `FirmsClient` (raw HTTP).
  - `FirmsCsvParser` normalizes MODIS and VIIRS columns and confidence.
- **Quota.** FIRMS allows 5,000 transactions per 10 minutes. **Measured cost: 2 transactions per day requested, independent of area or row count.** This is why tiles are large and chunks are 1 day.
  - `FirmsRateGuard` counts weighted cost (`Days × TransactionsPerDay`). `FirmsStatusPoller` re-syncs it with FIRMS `mapkey_status`.
  - Above `Firms:SoftLimit`, cache misses throw `FirmsQuotaException` inside the HybridCache factory (so nothing gets cached). The API then returns `partial: true` and lists the missing tiles.
- **Cache keys** include the tile size (`firms:{source}:{date}_{n}d:{size}deg_{x}_{y}`). If you change `TileSizeDeg` or `ChunkDays`, purge `App_Data/firms-cache/` (`DELETE /api/cache` in Development).
- **TTL:** SP data, and NRT data older than `NrtSettleDays`, are cached for 30 days. Recent NRT is cached for 20 minutes.
- **Errors → HTTP** via `Infrastructure/ApiExceptionFilter`: `ArgumentException`→400, `KeyNotFoundException`→404, `QueryTooLargeException`→422.
- **Settings:** all limits live in `appsettings.json` (`Firms:*`, `Api:*`). `/api/config` passes the ones the frontend needs (`tileSizeDeg`, `requestGridDeg`, `mapMaxTiles`, `maxRangeDays`, `transactionsPerDay`).

## Frontend architecture (src/FireMap.Web/ClientApp/src)

- **Shell (`App.tsx`):** top bar (EN/UA, Light/Dark/System, About) and two tabs.
  - Each tab owns its own Leaflet map (`map/createMap.ts`).
  - A tab is mounted on first visit and then kept hidden. The map viewport is handed over between tabs.
- **URL hash** (`lib/hashState.ts`) is the shareable state of the active tab:
  - `#history;a:spain;m:raw|harm;v:counts|unusual;w:2024-06-24;r:w,s,e,n;@lat,lon,zz`
  - `#forecast;d:A..A;b:B..B;l:layers;@lat,lon,zz;c:ISO3|r:w,s,e,n`
  - Old links without a tab prefix (`#d:…`) open Forecast.
- **Layout:**
  - Design tokens and all styles are in `styles/index.css`. Dark mode uses `:root[data-theme=dark]`.
  - Below 760 px the side panel (`components/SidePanel.tsx`) becomes a bottom drawer.
  - In dark mode a CSS filter inverts the OSM tiles (`.tiles-themed`). CARTO tiles are not used because they now need an API key.
- **i18n** (`i18n/en.ts`, `uk.ts`): `useI18n()` → `t(key, params)`. Language order: `?lang=` → saved choice → browser language → English.

### History tab (`features/history/`)
- **Data** is static under `wwwroot/data/calendar/`, loaded by `data.ts`:
  - `index.json`, and one `{area}.json` per preset.
  - 0.5° grids as `grid_*.meta.json` + `grid_*.bin.gz`. The binary holds Uint16 counts at `(series*C + cell)*W + week`. Cells are `[iy, ix]` = floor(lat/deg), floor(lon/deg).
  - Grids load on demand. The browser unpacks the gzip itself, so they are served without `Content-Encoding`.
- **`lib/chain.js`** is spacechallenge's `app/chain.js` with only the UMD wrapper replaced by `export`, so it stays diffable against upstream. Types are in `chain.d.ts`.
  - It runs on the main thread: Spain (249 cells) takes about 80 ms.
- **Drawn rectangle:** the app picks the grid with the most cells inside the rectangle, then runs `K367.buildAoiData`, which gives the same view model as a preset.
  - With too little data it uses region-wide coefficients and shows a warning (spacechallenge thresholds).
- **Cell map** (`CellLayer.ts`):
  - The raw view shows the cell's own counts.
  - The harmonized view shows the cell's share of the area's raw total × the area's `harm.est`, labelled as a scaled estimate.
- **Calendar** (`Calendar.tsx`): canvas week × year heatmap, showing Counts or Unusual weeks, keyboard navigable. It stays in sync with the scrubber and the map.

### Forecast tab (`features/forecast/`)
Port of the earlier vanilla-JS map, same behaviour:
- **`HotspotLayers.ts`:**
  - Each layer holds one **slot per period**: one period normally, A and B in compare mode.
  - All markers draw on one shared `L.canvas` in the `hotspots` pane. Canvas draw order = insertion order; B is drawn before A so A stays on top.
  - Request URLs are snapped to `requestGridDeg`, so small pans hit the browser LRU.
  - A selection filter switches requests from the viewport to `bbox=`/`country=`.
  - Markers are built once per response and indexed by UTC day (`byDay`). The timeline only swaps which markers are drawn, with no refetch.
- **`TimelineBar.tsx`:** client-side playback over the loaded data. In compare mode, days are aligned by index (day *n* of A beside day *n* of B).
- **`AreaSelector.ts`:**
  - Rectangle (Geoman) or country; only one is active at a time, and pressing a tool button again removes its filter.
  - Country hit-testing is JS point-in-polygon on map events, because the points canvas would swallow events meant for country polygons.
- **`StatsView.tsx`:** stats and the A-vs-B comparison table.
- **Date inputs only validate while you edit; nothing loads until Apply/Enter.** Keep it that way: applying on each change made two-ended range edits impossible.
- **Colours:** layer colours come from `/api/layers`. Period colours are the CSS vars `--period-a` / `--period-b`, read by JS.
- **`outlook.ts`:** typed `OutlookProvider` stub for the team's Outlook model (ADR 0009). It has no UI yet.

## Country boundaries — hard requirement

`wwwroot/data/countries.json` is shared by the map and the server-side stats. It comes from Natural Earth 1:10m **Ukraine point of view** (`ne_10m_admin_0_countries_ukr`), so **Crimea and all occupied territories are part of Ukraine**. In this dataset Kosovo is part of Serbia.
- Regenerate with `dotnet run tools/SlimCountries.cs -- <in.geojson> <out.json> 0.02`. The script checks that Simferopol, Sevastopol and Kerch fall inside UKR.
- Before adding any boundary, admin-1, geocoding or base-map source, check how it treats Crimea and raise it with the user if it differs.

### History data and the Ukraine exclusion
The spacechallenge pipeline builds its data with default Natural Earth boundaries, in which Crimea is **not** part of Ukraine. Until it is rebuilt with `ne_10m_admin_0_countries_ukr`, **Ukraine is left out of the History tab**.
- Import with `dotnet run tools/ImportCalendarData.cs -- <spacechallenge app/data> src/FireMap.Web/wwwroot/data/calendar`. The tool:
  - drops `ukraine.json` and removes it from `index.json`, where it is listed under `excluded`;
  - removes every grid cell whose 0.5° square touches UKR in `countries.json`, and re-slices the binary;
  - fails if the boundary file does not put Simferopol, Sevastopol and Kerch inside UKR.
- When rebuilt data arrives:
  - Import it with `--require-crimea`. That keeps Ukraine, and fails unless the grids hold the cells of those three cities.
  - Then remove `EXCLUDED_AREAS` and the matching notice in the History tab.
