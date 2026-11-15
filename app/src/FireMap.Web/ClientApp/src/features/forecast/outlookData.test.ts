// The forecast file (wwwroot/data/outlook/spain.json) is copied by hand from the team's
// ml/model/prediction/spain_forecast.json. These checks make sure a new run keeps the shape the Forecast tab reads.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isExperimentalDay, outlookClass, percent, type OutlookFile } from './outlook';

const FILE = resolve(__dirname, '../../../../wwwroot/data/outlook/spain.json');

describe('outlook helpers', () => {
  it('puts probabilities into the legend classes', () => {
    expect([null, 0, 0.0099, 0.01, 0.019, 0.02, 0.05, 0.1, 0.2, 0.9].map(outlookClass)).toEqual([0, 0, 0, 1, 1, 2, 3, 4, 5, 5]);
  });
  it('formats percentages', () => {
    const nf = (v: number) => String(Math.round(v));
    expect([percent(null, nf), percent(0.004, nf), percent(0.143, nf)]).toEqual(['–', '<1%', '14%']);
  });
});

describe('wwwroot/data/outlook/spain.json', () => {
  it('exists', () => expect(existsSync(FILE)).toBe(true));

  const d = JSON.parse(readFileSync(FILE, 'utf8')) as OutlookFile;
  const deg = d.cell_degrees;
  const [W, S, E, N] = d.bbox_wsen;

  it('has a 0.25° grid inside its bounding box', () => {
    expect(deg).toBe(0.25);
    expect(d.cells.length).toBeGreaterThan(0);
    const keys = new Set<string>();
    for (const c of d.cells) {
      expect(c.cell_y).toBe(Math.floor(c.lat_center / deg));
      expect(c.cell_x).toBe(Math.floor(c.lon_center / deg));
      const [w, s, e, n] = c.bbox_wsen;
      expect(w >= W && e <= E && s >= S && n <= N, `${c.cell_y},${c.cell_x} inside bbox`).toBe(true);
      expect(e - w).toBeCloseTo(deg);
      expect(n - s).toBeCloseTo(deg);
      keys.add(`${c.cell_y},${c.cell_x}`);
    }
    expect(keys.size, 'unique cells').toBe(d.cells.length);
  });

  it('has consecutive days with one probability per cell', () => {
    const p = d.series.noaa20_detection_probability;
    expect(d.days.length).toBeGreaterThan(0);
    expect(p.length).toBe(d.days.length);
    d.days.forEach((day, i) => {
      if (i) expect(Date.parse(day + 'T00:00:00Z') - Date.parse(d.days[i - 1] + 'T00:00:00Z'), day).toBe(86_400_000);
      expect(p[i].length, day).toBe(d.cells.length);
      expect(p[i].every((x) => x === null || (x >= 0 && x <= 1)), `${day}: values in 0–1 or null`).toBe(true);
    });
  });

  it('flags the cells outside the training grid and marks each day trained or experimental', () => {
    const t = d.quality.training_grid_bbox_wsen;
    expect(t, 'training_grid_bbox_wsen').toBeDefined();
    const [tw, ts, te, tn] = t!;
    for (const c of d.cells) {
      const inside = c.lon_center > tw && c.lon_center < te && c.lat_center > ts && c.lat_center < tn;
      expect(!!c.outside_training_grid, `${c.cell_y},${c.cell_x}`).toBe(!inside);
    }
    const m = d.quality.method_by_day!;
    expect(m.length).toBe(d.days.length);
    expect(m.every((x) => x === 'trained_horizon' || x === 'experimental')).toBe(true);
    expect(d.days.filter((_, i) => isExperimentalDay(d, i)).length).toBe(m.filter((x) => x === 'experimental').length);
  });

  it('says when and from which weather run it was issued', () => {
    expect(Number.isNaN(Date.parse(d.data_policy.issue_utc))).toBe(false);
    expect(Number.isNaN(Date.parse(d.data_policy.gfs_run_utc))).toBe(false);
  });
});
