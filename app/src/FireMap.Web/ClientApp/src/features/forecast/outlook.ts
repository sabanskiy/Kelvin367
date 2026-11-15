// Extension point for the team's Fire Outlook model (ADR 0009, fire-outlook-data-contract.md).
// Today the Forecast tab shows one static outlook file (OutlookFile below, wwwroot/data/outlook/spain.json):
// the team's CatBoost model (ml/) for central Spain, copied unchanged from ml/model/prediction/spain_forecast.json.
// The OutlookProvider contract is kept for a future model API.
//
// V0 contract: P(VIIRS records ≥ 1 accepted hotspot in a 0.25° cell on target_date | data available on issue_date),
// Spain only, horizons D+1/3/5/10. It is a forecast of satellite-observed hotspot activity, not of ignition.
import type { Bbox } from '../../lib/geo';

export interface OutlookRequest {
  /** Area as a bounding box, or explicit cell ids of the model grid. */
  area: { bbox: Bbox } | { cells: string[] };
  dateFrom: string;
  dateTo: string;
}

export interface OutlookCell {
  cellId: string;
  /** Cell centre, WGS84. */
  lat: number;
  lon: number;
  targetDate: string;
  /** 0–1 */
  probability: number;
  lo: number;
  hi: number;
}

export interface OutlookResponse {
  modelVersion: string;
  generatedAt: string;
  issueDate: string;
  gridDeg: number;
  partial: boolean;
  cells: OutlookCell[];
}

export interface OutlookProvider {
  /** Whether the model covers this area at all (V0: Spain only). */
  covers(bbox: Bbox): boolean;
  /** Must tolerate slow answers (up to ~10 s) and return partial results rather than fail. */
  fetch(req: OutlookRequest, signal?: AbortSignal): Promise<OutlookResponse>;
}

/** Placeholder until the model API is available. */
export const noOutlook: OutlookProvider = {
  covers: () => false,
  fetch: () => Promise.reject(new Error('Forecast model is not available yet.')),
};

// ---- static outlook file (ml/model/prediction/spain_forecast.json) ------------------------------------

export interface OutlookFileCell {
  cell_y: number;
  cell_x: number;
  lat_center: number;
  lon_center: number;
  /** [west, south, east, north]; west/south inclusive, east/north exclusive. */
  bbox_wsen: [number, number, number, number];
}

/** The team's daily grid forecast: P(≥1 NOAA-20 FIRMS detection in the cell on each UTC day). */
export interface OutlookFile {
  id: string;
  name: string;
  kind: string;
  bbox_wsen: [number, number, number, number];
  cell_degrees: number;
  cells: OutlookFileCell[];
  /** Target UTC days, one series row each. */
  days: string[];
  series: { noaa20_detection_probability: (number | null)[][] };
  quality: { target: string; model_run: string };
  data_policy: { issue_utc: string; gfs_run_utc: string };
  warnings?: string[];
}

export async function loadOutlook(url = '/data/outlook/spain.json'): Promise<OutlookFile> {
  const r = await fetch(url, { cache: 'no-cache' }); // replaced when the team publishes a new run
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as OutlookFile;
}

/** Lower bounds of the probability classes on the map and in the legend (most cells are below 1%). */
export const OUTLOOK_BREAKS = [0.01, 0.02, 0.05, 0.1, 0.2];

/** Class 0 = below 1% (outline only), 1..5 = the coloured classes. */
export function outlookClass(p: number | null | undefined): number {
  if (p == null) return 0;
  let k = 0;
  while (k < OUTLOOK_BREAKS.length && p >= OUTLOOK_BREAKS[k]) k++;
  return k;
}

/** "14%", or "<1%" for the faint cells. */
export const percent = (p: number | null | undefined, nf: (v: number, digits?: number) => string) =>
  p == null ? '–' : p < 0.01 ? '<1%' : `${nf(p * 100, 0)}%`;
