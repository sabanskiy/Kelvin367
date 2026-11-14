// History view model: pure functions over one area record (port of spacechallenge app.js helpers).
import K367, { type AoiData, type Grid } from '../../lib/chain';
import type { HistoryMode } from '../../lib/hashState';

/** Split year of the "unusual weeks" baseline: percentiles compare each week with the same season before it. */
export const SPLIT_YEAR = 2022;

export interface Prepared extends AoiData {
  year: number[];
  /** Week of year, 0..51 (calendar column). */
  woy: number[];
  years: number[];
  gapAny: Set<number>;
  weekIndex: Map<string, number>;
}

export function prepare(d: AoiData): Prepared {
  const year: number[] = [];
  const woy: number[] = [];
  for (const w of d.weeks) {
    const t = Date.parse(w + 'T00:00:00Z');
    const y = new Date(t).getUTCFullYear();
    year.push(y);
    woy.push(Math.min(Math.floor((t - Date.UTC(y, 0, 1)) / 86_400_000 / 7), 51));
  }
  return {
    ...d,
    year,
    woy,
    years: [...new Set(year)],
    gapAny: new Set(Object.values(d.gap_weeks ?? {}).flat()),
    weekIndex: new Map(d.weeks.map((w, i) => [w, i])),
  };
}

export const hasRaw = (d: AoiData) => Array.isArray(d.series.naive);

export interface Shown {
  est: (number | null)[];
  lo: (number | null)[];
  hi: (number | null)[];
  src: string[];
}

/** The displayed weekly series: raw stitched sensors, or harmonized to the MODIS scale. */
export function shownSeries(d: Prepared, mode: HistoryMode): Shown {
  const s = d.series, n = d.weeks.length;
  if (mode === 'raw' && s.naive) {
    return {
      est: s.naive,
      lo: new Array(n).fill(null),
      hi: new Array(n).fill(null),
      src: d.year.map((y) => (y < 2012 ? 'MODIS (raw)' : 'VIIRS S-NPP (raw)')),
    };
  }
  return { est: s.harm.est, lo: s.harm.lo, hi: s.harm.hi, src: s.harm.src.map((c) => d.src_codes[c] ?? '') };
}

const nz = (a: (number | null)[]) => a.map((x) => (x == null ? NaN : x));
const toNull = (a: number[]) => a.map((x) => (Number.isNaN(x) ? null : x));

const pctCache = new WeakMap<Prepared, Partial<Record<HistoryMode, (number | null)[]>>>();

/** Percentile of each week against the same season in the years before SPLIT_YEAR (spacechallenge default). */
export function percentiles(d: Prepared, mode: HistoryMode): (number | null)[] {
  let c = pctCache.get(d);
  if (!c) pctCache.set(d, (c = {}));
  if (!c[mode]) {
    const vals = nz(shownSeries(d, mode).est);
    c[mode] = toNull(K367.stratifiedPercentile(vals, vals, d.weeks, SPLIT_YEAR, 'pre'));
  }
  return c[mode]!;
}

// ---- key numbers -----------------------------------------------------------------------------

export type NowLabel = 'off' | 'low' | 'below' | 'normal' | 'above' | 'high' | 'extreme';

export interface Latest {
  week: string;
  value: number;
  pct: number;
  label: NowLabel;
  tone: '' | 'hot' | 'warm' | 'cool';
}

export function latestWeek(d: Prepared, mode: HistoryMode): Latest | null {
  const r = K367.latestVsNormal(nz(shownSeries(d, mode).est), d.weeks, 12);
  if (!r) return null;
  const p = r.pct;
  const label: NowLabel =
    r.median < 5 && r.value < 5 ? 'off' : p >= 97 ? 'extreme' : p >= 90 ? 'high' : p >= 75 ? 'above' : p >= 25 ? 'normal' : p >= 10 ? 'below' : 'low';
  const tone = p >= 90 ? 'hot' : p >= 75 ? 'warm' : p < 25 ? 'cool' : '';
  return { week: r.week, value: r.value, pct: p, label, tone };
}

const mean = (a: (number | null)[]) => {
  const v = a.filter((x): x is number => x != null);
  return v.length ? v.reduce((p, c) => p + c, 0) / v.length : null;
};

/** Mean 2012-16 against MODIS 2007-11: the step raw VIIRS makes, and the same comparison harmonized. */
export function sensorJump(d: Prepared): { raw: number; harm: number } | null {
  const s = d.series;
  if (!s.naive) return null;
  const take = (arr: (number | null)[], y0: number, y1: number) => arr.filter((_, i) => d.year[i] >= y0 && d.year[i] <= y1);
  const pre = mean(take(s.modis, 2007, 2011));
  const naive = mean(take(s.naive, 2012, 2016));
  const harm = mean(take(s.harm.est, 2012, 2016));
  if (!pre || naive == null || harm == null) return null;
  return { raw: naive / pre, harm: harm / pre };
}

// ---- CSV -------------------------------------------------------------------------------------

export function toCsv(d: Prepared, mode: HistoryMode): string {
  const s = d.series, sh = shownSeries(d, mode), pct = percentiles(d, mode);
  const v = (x: number | null | undefined) => (x == null ? '' : x);
  const rows = ['week_start,modis_raw,snpp_raw,noaa20_raw,noaa21_raw,shown_scale,shown_value,lo80,hi80,source,percentile,known_gap'];
  const scale = mode === 'raw' && s.naive ? 'raw_stitched' : 'modis_equivalent';
  d.weeks.forEach((w, i) =>
    rows.push(
      [
        w,
        v(s.modis[i]),
        v(s.viirs_snpp?.[i]),
        v(s.viirs_noaa20?.[i]),
        v(s.viirs_noaa21?.[i]),
        scale,
        v(sh.est[i]),
        v(sh.lo[i]),
        v(sh.hi[i]),
        sh.src[i],
        v(pct[i]),
        d.gapAny.has(i) ? 1 : 0,
      ].join(','),
    ),
  );
  return rows.join('\n');
}

// ---- 0.5° cell map ---------------------------------------------------------------------------

export interface CellView {
  /** Grid cell indices drawn for this area. */
  cells: number[];
  /** Area week index → grid week index (or -1). */
  gridWeek: Int32Array;
  /** Fixed colour scale maximum (99th percentile over all weeks), per mode. */
  vmax: Partial<Record<HistoryMode, number>>;
}

export function makeCellView(d: Prepared, grid: Grid, cells: number[]): CellView {
  const gi = new Map(grid.meta.weeks.map((w, i) => [w, i]));
  return { cells, gridWeek: Int32Array.from(d.weeks, (w) => gi.get(w) ?? -1), vmax: {} };
}

/** Raw stitched count of each cell in grid week `gw`: MODIS before the naive cut-off, S-NPP after (as the area's "naive" series). */
export function cellRaw(grid: Grid, cells: number[], gw: number): Float64Array {
  const { C, W, data, idx, meta } = grid;
  const out = new Float64Array(cells.length);
  if (gw < 0) return out;
  const modis = meta.naive_cutoff && meta.weeks[gw] >= meta.naive_cutoff ? null : ['Terra_D', 'Terra_N', 'Aqua_D', 'Aqua_N'];
  const names = modis ?? ['SNPP_D', 'SNPP_N'];
  const series = names.map((n) => idx[n]).filter((s) => s !== undefined);
  for (let k = 0; k < cells.length; k++) {
    let v = 0;
    for (const s of series) v += data[(s * C + cells[k]) * W + gw];
    out[k] = v;
  }
  return out;
}

/**
 * Cell values for area week `i`. Raw = the cell's stitched count. Harmonized = the cell's share of the
 * raw total of the drawn cells × the area's harmonized estimate (per-cell harmonization is not in the data).
 */
export function cellValues(d: Prepared, grid: Grid, view: CellView, i: number, mode: HistoryMode): Float64Array {
  const raw = cellRaw(grid, view.cells, view.gridWeek[i]);
  if (mode === 'raw') return raw;
  let sum = 0;
  for (const v of raw) sum += v;
  const target = d.series.harm.est[i];
  if (!sum || target == null) return raw.fill(0);
  const f = target / sum;
  for (let k = 0; k < raw.length; k++) raw[k] *= f;
  return raw;
}

export function cellVmax(d: Prepared, grid: Grid, view: CellView, mode: HistoryMode): number {
  const cached = view.vmax[mode];
  if (cached) return cached;
  const vals: number[] = [];
  for (let i = 0; i < d.weeks.length; i++) {
    for (const v of cellValues(d, grid, view, i, mode)) if (v > 0) vals.push(v);
  }
  vals.sort((a, b) => a - b);
  const vmax = vals.length ? vals[Math.min(vals.length - 1, Math.floor(0.99 * vals.length))] : 1;
  view.vmax[mode] = vmax || 1;
  return view.vmax[mode]!;
}

// ---- colours -----------------------------------------------------------------------------------

/** Sequential cream → dark red (Figma "ramp" / spacechallenge SEQ). */
export const SEQ: [number, number, number][] = [[255, 247, 230], [253, 224, 160], [248, 170, 90], [226, 100, 40], [168, 40, 24], [74, 14, 14]];
/** Diverging steel blue → burnt orange for percentiles (quieter → busier). */
export const DIV: [number, number, number][] = [[31, 95, 139], [140, 185, 215], [235, 233, 228], [244, 176, 120], [194, 65, 12]];

export function ramp(stops: [number, number, number][], t: number): string {
  t = Math.max(0, Math.min(1, t));
  const x = t * (stops.length - 1), i = Math.min(Math.floor(x), stops.length - 2), f = x - i;
  const c = (k: number) => Math.round(stops[i][k] + (stops[i + 1][k] - stops[i][k]) * f);
  return `rgb(${c(0)},${c(1)},${c(2)})`;
}

export const seqColor = (v: number, vmax: number) => ramp(SEQ, Math.sqrt(Math.max(0, v) / (vmax || 1)));
export const divColor = (p: number) => ramp(DIV, p / 100);

export function quantile(arr: (number | null)[], q: number): number {
  const a = arr.filter((v): v is number => v != null).sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : 1;
}

/** Approximate area of a 0.5° cell in km². */
export function cellKm2(iy: number, deg: number): number {
  const lat = (iy + 0.5) * deg;
  return 111.32 * deg * 111.32 * deg * Math.cos((lat * Math.PI) / 180);
}
