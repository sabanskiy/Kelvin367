// Thin wrappers around the backend API. All NASA calls go through the backend (key, cache, quota).
import type { Bbox } from './geo';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface AppConfig {
  mode: 'live' | 'sample';
  today: string;
  tileSizeDeg: number;
  maxRangeDays: number;
  mapMaxTiles: number;
  requestGridDeg: number;
  transactionsPerDay: number;
  maxPointsPerResponse: number;
}

export interface LayerDef {
  id: string;
  name: string;
  group: string;
  color: string;
  instrument: string;
  resolutionM: number;
  description: string;
  defaultVisible: boolean;
  minDate: string | null;
  maxDate: string | null;
}

export interface ServerStatus {
  mode: 'live' | 'sample';
  quota: { transactionsUsed: number; limit: number; softLimit: number };
  cache: { hits: number; upstreamCalls: number };
  disk: { files: number; sizeMb: number };
}

export interface HotspotProps {
  acquired: string;
  satellite: string;
  instrument: string;
  frp: number | null;
  confidence: string;
  confidencePct: number | null;
  brightness: number | null;
  dayNight: 'D' | 'N' | null;
  scan: number | null;
  track: number | null;
  source: string;
}

export interface HotspotFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: HotspotProps;
}

export interface HotspotCollection {
  type: 'FeatureCollection';
  layer: string;
  from: string;
  to: string;
  totalCount: number;
  truncated: boolean;
  partial: boolean;
  missing: string[];
  features: HotspotFeature[];
}

export interface DailyStat { date: string; count: number; frpSum: number }

export interface LayerStats {
  layerId: string;
  name: string;
  color: string;
  count: number;
  dayCount: number;
  nightCount: number;
  confidence: { low: number; nominal: number; high: number };
  frp: { sum: number; mean: number; median: number; max: number };
  densityPer1000Km2: number;
  daily: DailyStat[];
  partial: boolean;
  missing: string[];
}

export interface StatsResult {
  area: { kind: string; name: string; iso3: string | null; bbox: number[]; areaKm2: number };
  from: string;
  to: string;
  layers: LayerStats[];
  comparisons: { layerA: string; layerB: string; countRatio: number | null; frpRatio: number | null }[];
  partial: boolean;
}

export interface StatsRequest {
  layers: string[];
  from: string;
  to: string;
  bbox?: Bbox;
  country?: string;
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...options, headers: { Accept: 'application/json', ...(options.headers ?? {}) } });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const problem = await res.json();
      detail = problem.detail || problem.title || detail;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

const query = (params: Record<string, string | undefined | null>) =>
  new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined && e[1] !== null && e[1] !== '')).toString();

export const api = {
  config: () => request<AppConfig>('/api/config'),
  layers: () => request<LayerDef[]>('/api/layers'),
  status: () => request<ServerStatus>('/api/status'),

  /** URL is also the browser-side cache key, so build it deterministically. */
  hotspotsUrl: ({ layer, bbox, country, from, to }: { layer: string; bbox?: Bbox; country?: string; from: string; to: string }) =>
    '/api/hotspots?' + query({ layer, bbox: bbox?.join(','), country, from, to }),

  hotspots: (url: string, signal?: AbortSignal) => request<HotspotCollection>(url, { signal }),

  stats: (body: StatsRequest, signal?: AbortSignal) =>
    request<StatsResult>('/api/stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    }),
};
