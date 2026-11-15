// The Area picker lists only presets whose 0.5° grid is deployed (wwwroot/data/calendar/grids.json).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AREA_GEO, listedAreas, type AreaIndexEntry, type GridIndexEntry } from './data';

const CAL = resolve(__dirname, '../../../../wwwroot/data/calendar');
const json = <T>(p: string): T => JSON.parse(readFileSync(resolve(CAL, p), 'utf8')) as T;
const aois = json<{ aois: AreaIndexEntry[] }>('index.json').aois;
const grids = json<{ grids: GridIndexEntry[] }>('grids.json').grids;

describe('listedAreas', () => {
  const ids = listedAreas(aois, grids).map((a) => a.id);

  it('keeps every preset that has a deployed grid', () => {
    expect(ids.sort()).toEqual(['chile', 'greece', 'iberia', 'italy', 'portugal', 'south_africa', 'spain', 'ukraine']);
  });

  it('hides Canada and Indonesia until their grids exist', () => {
    expect(AREA_GEO.canada.grid).toBeNull();
    expect(ids).not.toContain('canada');
    expect(ids).not.toContain('indonesia');
  });

  it('hides a preset whose grid id is set but whose grid file is not deployed', () => {
    const withoutEurope = grids.filter((g) => g.id !== 'grid_europe');
    expect(listedAreas(aois, withoutEurope).map((a) => a.id).sort()).toEqual(['chile', 'south_africa']);
  });
});
