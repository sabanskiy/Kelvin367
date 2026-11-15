// Ver. 1 (the pipeline's data) vs Ver. 2 (the new algorithm, calendar/v2) for one area. The two use different units
// (detections vs MODIS-equivalent active cells), so every measure here is unit-free.
import { percentiles, type Prepared } from './model';

export interface Comparison {
  /** Weeks with a harmonized value in both datasets. */
  weeks: number;
  /** Spearman rank correlation of the weekly harmonized values. */
  rank: number | null;
  /** Median of new ÷ current over the weeks where both are above zero. */
  scale: number | null;
  /** Weeks at or above the 90th percentile (same season, years before 2022) in each dataset and in both. */
  unusual: { current: number; next: number; both: number };
  /** Harmonized ÷ MODIS over 2012-2022, within each dataset: 1 means the series stays on the MODIS scale. */
  onModis: { current: number | null; next: number | null };
}

const UNUSUAL = 90;

export function compareDatasets(current: Prepared, next: Prepared): Comparison {
  const a: number[] = [], b: number[] = [], ia: number[] = [], ib: number[] = [];
  current.weeks.forEach((w, i) => {
    const j = next.weekIndex.get(w);
    if (j === undefined) return;
    const x = current.series.harm.est[i], y = next.series.harm.est[j];
    if (x == null || y == null) return;
    a.push(x);
    b.push(y);
    ia.push(i);
    ib.push(j);
  });

  const ratios = a.flatMap((x, k) => (x > 0 && b[k] > 0 ? [b[k] / x] : []));
  const pa = percentiles(current, 'harm'), pb = percentiles(next, 'harm');
  let uc = 0, un = 0, both = 0;
  ia.forEach((i, k) => {
    const hiA = (pa[i] ?? -1) >= UNUSUAL, hiB = (pb[ib[k]] ?? -1) >= UNUSUAL;
    uc += +hiA;
    un += +hiB;
    both += +(hiA && hiB);
  });

  return {
    weeks: a.length,
    rank: spearman(a, b),
    scale: ratios.length ? median(ratios) : null,
    unusual: { current: uc, next: un, both },
    onModis: { current: harmOnModis(current), next: harmOnModis(next) },
  };
}

/** Sum of harmonized ÷ sum of MODIS over 2012-2022 weeks that have both (MODIS still flying, VIIRS in use). */
export function harmOnModis(d: Prepared, from = 2012, to = 2022): number | null {
  let h = 0, m = 0;
  d.weeks.forEach((_, i) => {
    const x = d.series.harm.est[i], y = d.series.modis[i];
    if (d.year[i] < from || d.year[i] > to || x == null || y == null) return;
    h += x;
    m += y;
  });
  return m > 0 ? h / m : null;
}

export function median(v: number[]): number {
  const s = [...v].sort((x, y) => x - y), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** Ranks from 1, ties get their mean rank. */
export function ranks(v: number[]): number[] {
  const order = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
  const r = new Array<number>(v.length);
  for (let k = 0; k < order.length; ) {
    let e = k;
    while (e + 1 < order.length && order[e + 1][0] === order[k][0]) e++;
    for (let t = k; t <= e; t++) r[order[t][1]] = (k + e) / 2 + 1;
    k = e + 1;
  }
  return r;
}

export function spearman(a: number[], b: number[]): number | null {
  if (a.length < 3) return null;
  const ra = ranks(a), rb = ranks(b), n = a.length, ma = (n + 1) / 2;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (ra[i] - ma) * (rb[i] - ma);
    sxx += (ra[i] - ma) ** 2;
    syy += (rb[i] - ma) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}
