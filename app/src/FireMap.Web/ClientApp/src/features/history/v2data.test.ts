// The new algorithm's test data (wwwroot/data/calendar/v2) is copied in by hand, not through
// tools/ImportCalendarData.cs, so these checks stand in for the import tool: every file listed in
// v2/index.json must have the shape the History tab reads.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AoiData } from '../../lib/chain';
import { compareDatasets, median, ranks, spearman } from './compare';
import { AREA_GEO, type V2Index } from './data';
import { prepare } from './model';

const CAL = resolve(__dirname, '../../../../wwwroot/data/calendar');
const json = <T>(p: string): T => JSON.parse(readFileSync(resolve(CAL, p), 'utf8')) as T;
const v2 = json<V2Index>('v2/index.json');
const v1Ids = new Set(json<{ aois: { id: string }[] }>('index.json').aois.map((a) => a.id));

describe('compare helpers', () => {
  it('ranks ties by their mean rank', () => {
    expect(ranks([10, 20, 20, 5])).toEqual([2, 3.5, 3.5, 1]);
  });
  it('spearman is 1 for any increasing transform and -1 for a reversed order', () => {
    expect(spearman([1, 2, 3, 4], [1, 4, 9, 100])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
    expect(spearman([1, 2], [1, 2])).toBeNull();
  });
  it('median of odd and even lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe('v2 index', () => {
  it('lists areas the app knows, once each', () => {
    expect(v2.aois.length).toBeGreaterThan(0);
    const ids = v2.aois.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(v1Ids.has(id), `${id} is a current preset`).toBe(true);
      expect(AREA_GEO[id], `${id} in AREA_GEO`).toBeDefined();
    }
  });
});

const isWeekValue = (x: unknown) => x === null || (typeof x === 'number' && Number.isFinite(x) && x >= 0);

describe.each(v2.aois.map((a) => [a.id, a] as const))('v2/%s.json', (id, entry) => {
  const file = `v2/${id}.json`;

  it('exists', () => expect(existsSync(resolve(CAL, file))).toBe(true));

  const d = json<AoiData>(file);
  const W = d.weeks.length;

  it('matches its index entry', () => {
    expect(d.id).toBe(id);
    expect(d.weeks[0]).toBe(entry.from);
    expect(d.weeks[W - 1]).toBe(entry.to);
  });

  it('has consecutive Monday weeks', () => {
    d.weeks.forEach((w, i) => {
      const t = Date.parse(w + 'T00:00:00Z');
      expect(new Date(t).getUTCDay(), w).toBe(1);
      if (i) expect(t - Date.parse(d.weeks[i - 1] + 'T00:00:00Z'), w).toBe(7 * 86_400_000);
    });
  });

  it('has one value per week in every series', () => {
    const s = d.series;
    const lists: [string, unknown[] | undefined][] = [
      ['modis', s.modis],
      ['viirs_snpp', s.viirs_snpp],
      ['viirs_noaa20', s.viirs_noaa20],
      ['viirs_noaa21', s.viirs_noaa21],
      ['harm.est', s.harm.est],
      ['harm.lo', s.harm.lo],
      ['harm.hi', s.harm.hi],
      ['harm_viirs.est', s.harm_viirs.est],
      ['harm_viirs.lo', s.harm_viirs.lo],
      ['harm_viirs.hi', s.harm_viirs.hi],
    ];
    for (const [name, v] of lists) {
      if (v === undefined) continue;
      expect(v.length, name).toBe(W);
      expect(v.every(isWeekValue), `${name}: numbers ≥ 0 or null`).toBe(true);
    }
    for (const band of ['harm', 'harm_viirs'] as const) {
      const src = s[band].src;
      expect(src.length, `${band}.src`).toBe(W);
      expect(src.every((c) => Number.isInteger(c) && c >= 0 && c < d.src_codes.length), `${band}.src in src_codes`).toBe(true);
    }
  });

  it('has week flags inside the record', () => {
    const flags = [...Object.values(d.gap_weeks ?? {}).flat(), ...(d.provisional_weeks ?? []), ...(d.out_of_domain_weeks ?? [])];
    expect(flags.every((i) => Number.isInteger(i) && i >= 0 && i < W)).toBe(true);
  });

  it('can be compared with the current data', () => {
    const c = compareDatasets(prepare(json<AoiData>(`${id}.json`)), prepare(d));
    console.info(`${id} current vs v2: ${JSON.stringify(c)}`);
    expect(c.weeks).toBeGreaterThan(52);
    expect(c.rank).not.toBeNull();
  });
});
