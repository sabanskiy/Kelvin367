// The browser calibration chain (chain.js, used for drawn areas) against the preset built by the Python
// pipeline: Spain from the imported Europe grid must come out close to spain.json.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import K367, { type AoiData, type GridMeta } from './chain';
import { featureContains, type CountryCollection } from './geo';

const WWW = resolve(__dirname, '../../../wwwroot/data');
const json = <T>(p: string): T => JSON.parse(readFileSync(resolve(WWW, p), 'utf8')) as T;

const meta = json<GridMeta>('calendar/grid_europe.meta.json');
const bin = gunzipSync(readFileSync(resolve(WWW, 'calendar/grid_europe.bin.gz')));
const grid = K367.makeGrid(meta, new Uint16Array(bin.buffer, bin.byteOffset, bin.byteLength / 2));
const countries = json<CountryCollection>('countries.json');
const spain = json<AoiData>('calendar/spain.json');

const cellsIn = (iso3: string) => {
  const f = countries.features.find((x) => x.properties.iso3 === iso3)!;
  return meta.cells.flatMap(([iy, ix], c) => (featureContains(f, (ix + 0.5) * meta.deg, (iy + 0.5) * meta.deg) ? [c] : []));
};

const sum = (a: (number | null)[]) => a.reduce<number>((s, v) => s + (v ?? 0), 0);

/** Pearson correlation over the weeks both series have. */
function corr(a: (number | null)[], b: (number | null)[]): number {
  const xs: number[] = [], ys: number[] = [];
  a.forEach((v, i) => {
    if (v != null && b[i] != null) (xs.push(v), ys.push(b[i]!));
  });
  const mx = sum(xs) / xs.length, my = sum(ys) / ys.length;
  let sxy = 0, sxx = 0, syy = 0;
  xs.forEach((x, i) => {
    sxy += (x - mx) * (ys[i] - my);
    sxx += (x - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  });
  return sxy / Math.sqrt(sxx * syy);
}

describe('imported Europe grid', () => {
  it('holds no cell in Ukraine (Ukraine POV boundaries)', () => {
    expect(cellsIn('UKR')).toEqual([]);
    expect(bin.byteLength).toBe(grid.S * grid.C * grid.W * 2);
  });
});

/**
 * Cells holding the country's detections. Coastal cells often have their centre at sea, so test the square
 * (via its corners and centre) and leave cells on a shared land border to the country their centre is in.
 */
const cellsOf = (iso3: string, neighbours: string[]) => {
  const f = countries.features.find((x) => x.properties.iso3 === iso3)!;
  const nb = countries.features.filter((x) => neighbours.includes(x.properties.iso3));
  const g = meta.deg;
  return meta.cells.flatMap(([iy, ix], c) => {
    const pts: [number, number][] = [[0.5, 0.5], [0.02, 0.02], [0.98, 0.02], [0.02, 0.98], [0.98, 0.98], [0.5, 0.02], [0.5, 0.98], [0.02, 0.5], [0.98, 0.5]];
    const touches = pts.some(([fx, fy]) => featureContains(f, (ix + fx) * g, (iy + fy) * g));
    const otherCentre = nb.some((n) => featureContains(n, (ix + 0.5) * g, (iy + 0.5) * g));
    return touches && !otherCentre ? [c] : [];
  });
};

describe('chain.js on Spain grid cells vs spain.json', () => {
  let cells: number[], d: AoiData, ms: number;
  beforeAll(() => {
    cells = cellsOf('ESP', ['PRT']);
    const t0 = performance.now();
    d = K367.buildAoiData(grid, cells, 'Spain (grid)');
    ms = performance.now() - t0;
  });

  it('runs quickly enough for the main thread', () => {
    console.info(`buildAoiData: ${cells.length} cells, ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(2000);
  });

  it('sees the same raw MODIS record', () => {
    // Grid cells are clipped to the polygon and cells with < 10 detections are dropped: totals match closely.
    // Weeks may differ in length (the preset can run to a later week), so compare the common span.
    const n = Math.min(d.weeks.length, spain.weeks.length);
    expect(d.weeks[0]).toBe(spain.weeks[0]);
    const a = d.series.modis.slice(0, n), b = spain.series.modis.slice(0, n);
    console.info(`modis total ratio ${(sum(a) / sum(b)).toFixed(3)}, r = ${corr(a, b).toFixed(4)}`);
    expect(Math.abs(sum(a) / sum(b) - 1)).toBeLessThan(0.05);
    expect(corr(a, b)).toBeGreaterThan(0.99);
  });

  it('harmonizes to the same series as the pipeline', () => {
    const n = Math.min(d.weeks.length, spain.weeks.length);
    const a = d.series.harm.est.slice(0, n), b = spain.series.harm.est.slice(0, n);
    console.info(`harm.est total ratio ${(sum(a) / sum(b)).toFixed(3)}, r = ${corr(a, b).toFixed(4)}`);
    expect(Math.abs(sum(a) / sum(b) - 1)).toBeLessThan(0.1);
    expect(corr(a, b)).toBeGreaterThan(0.98);
  });
});
