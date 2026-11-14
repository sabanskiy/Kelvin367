// Types for the parts of chain.js (spacechallenge calibration chain) that the app calls.
// Field names follow scripts/build_calendar_data.py and chain.js buildAoiData.

export interface Platform {
  name: string;
  family: string;
  start: string;
  end: string | null;
  planned_end?: string;
  local_time?: string;
}

export interface KnownGap {
  platform: string;
  start: string;
  end: string;
}

export interface GridMeta {
  id: string;
  name: string;
  deg: number;
  weeks: string[];
  /** e.g. "Terra_D", "SNPP_N"; the binary holds Uint16 counts at (series * C + cell) * W + week. */
  series: string[];
  /** [iy, ix] with iy = floor(lat / deg), ix = floor(lon / deg). */
  cells: [number, number][];
  total: number[];
  platforms: Platform[];
  known_gaps: KnownGap[];
  valid_platforms: string[];
  links: { source: string; target: string; train: [string, string] }[];
  baseline_years: [number, number];
  naive_cutoff?: string;
  geometry_note: string;
  filter_note?: string;
  data_policy?: { lag_days: number; as_of: string; reason: string };
}

export interface Grid {
  meta: GridMeta;
  data: Uint16Array;
  S: number;
  C: number;
  W: number;
  idx: Record<string, number>;
}

export interface Band {
  est: (number | null)[];
  lo: (number | null)[];
  hi: (number | null)[];
  src: number[];
}

export interface Link {
  source: string;
  target: string;
  k_day: number;
  k_night: number;
  sigma: number[];
  sigma_sys: number;
  weeks: number;
  fallback?: boolean;
}

/** One area record: a preset ({area}.json) or a custom selection of grid cells (buildAoiData). */
export interface AoiData {
  id: string;
  name: string;
  kind: string;
  geometry_note: string;
  weeks: string[];
  series: {
    modis: (number | null)[];
    viirs_snpp?: (number | null)[];
    viirs_noaa20?: (number | null)[];
    viirs_noaa21?: (number | null)[];
    naive?: (number | null)[];
    harm: Band;
    harm_viirs: Band;
  };
  src_codes: string[];
  anomaly: { baseline: string; pct: (number | null)[]; pct_viirs: (number | null)[] };
  gap_weeks: Record<string, number[]>;
  quality: { links: Link[]; platforms: Platform[]; known_gaps: KnownGap[] };
  data_policy?: { lag_days: number; as_of: string; reason: string };
  warnings?: string[];
}

export interface LatestVsNormal {
  index: number;
  week: string;
  end: string;
  value: number;
  median: number;
  p25: number;
  p75: number;
  pct: number;
  n: number;
  ratio: number;
}

declare const K367: {
  makeGrid(meta: GridMeta, data: Uint16Array): Grid;
  buildAoiData(grid: Grid, cells: number[], name?: string): AoiData & { warnings: string[] };
  latestVsNormal(values: number[], weeks: string[], recent?: number): LatestVsNormal | null;
  /** Percentile of each week against the same season; mode "pre" = years before `split`. */
  stratifiedPercentile(values: number[], baseValues: number[], weeks: string[], split: number, mode: 'pre' | 'same'): number[];
};

export default K367;
