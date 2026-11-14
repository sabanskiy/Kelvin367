// Extension point for the team's Fire Outlook model (ADR 0009, fire-outlook-data-contract.md).
// Not wired into the UI yet: the Forecast tab shows observed FIRMS detections until a model API exists.
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
