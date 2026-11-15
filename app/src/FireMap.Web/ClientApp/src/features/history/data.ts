// Loading the calendar data imported from the spacechallenge pipeline (wwwroot/data/calendar, see
// tools/ImportCalendarData.cs). Ver. 2, harmonized with the team's new algorithm, sits in calendar/v2/
// (one {area}.json per area listed in v2/index.json); areas listed there get a Ver. 1 / Ver. 2 switch.
import K367, { type AoiData, type Grid, type GridMeta } from '../../lib/chain';

const BASE = '/data/calendar';

export interface AreaIndexEntry {
  id: string;
  name: string;
  kind: 'continuous' | 'archive';
  from: string;
  to: string;
  platforms: string[];
}

export interface GridIndexEntry {
  id: string;
  from: string;
  to: string;
  platforms: string[];
  cells: number;
}

/**
 * Where each preset lies on the 0.5° grids. Cells whose centre is inside one of the countries
 * (Natural Earth, Ukraine POV — the same file the map uses) are drawn for the preset.
 */
export const AREA_GEO: Record<string, { grid: string | null; iso3: string[] }> = {
  ukraine: { grid: 'grid_europe', iso3: ['UKR'] },
  iberia: { grid: 'grid_europe', iso3: ['ESP', 'PRT'] },
  spain: { grid: 'grid_europe', iso3: ['ESP'] },
  portugal: { grid: 'grid_europe', iso3: ['PRT'] },
  greece: { grid: 'grid_europe', iso3: ['GRC'] },
  italy: { grid: 'grid_europe', iso3: ['ITA'] },
  chile: { grid: 'grid_south_america', iso3: ['CHL'] },
  south_africa: { grid: 'grid_africa', iso3: ['ZAF'] },
  canada: { grid: null, iso3: ['CAN'] },
  indonesia: { grid: null, iso3: ['IDN'] },
};

/** Demo opens on Iberia (spacechallenge decision 6); presets in this order, unknown ids last. */
export const DEFAULT_AREA = 'iberia';
export const AREA_ORDER = ['iberia', 'ukraine', 'spain', 'portugal', 'greece', 'italy', 'chile', 'south_africa', 'canada', 'indonesia'];

// Data files change when the data are rebuilt: always revalidate.
const getJson = async <T>(url: string): Promise<T> => {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
};

let indexPromise: Promise<{ aois: AreaIndexEntry[]; grids: GridIndexEntry[] }> | null = null;

export function loadIndex(): Promise<{ aois: AreaIndexEntry[]; grids: GridIndexEntry[] }> {
  indexPromise ??= Promise.all([
    getJson<{ aois: AreaIndexEntry[] }>(`${BASE}/index.json`),
    getJson<{ grids: GridIndexEntry[] }>(`${BASE}/grids.json`).catch(() => ({ grids: [] })),
  ]).then(([idx, grids]) => {
    const rank = (id: string) => {
      const i = AREA_ORDER.indexOf(id);
      return i < 0 ? AREA_ORDER.length : i;
    };
    return { aois: [...idx.aois].sort((a, b) => rank(a.id) - rank(b.id)), grids: grids.grids };
  });
  return indexPromise;
}

/** Ver. 1 (the pipeline's data) or Ver. 2 (the new algorithm, calendar/v2). */
export type Dataset = 'v1' | 'v2';

export interface V2Index {
  about: string;
  unit: string;
  aois: { id: string; from: string; to: string; source: string }[];
}

let v2Promise: Promise<V2Index> | null = null;

/** Areas with new-algorithm data; empty when the folder is not deployed. */
export function loadV2Index(): Promise<V2Index> {
  v2Promise ??= getJson<V2Index>(`${BASE}/v2/index.json`).catch(() => ({ about: '', unit: '', aois: [] }));
  return v2Promise;
}

const areaCache = new Map<string, Promise<AoiData>>();

export function loadArea(id: string, dataset: Dataset = 'v1'): Promise<AoiData> {
  const url = dataset === 'v2' ? `${BASE}/v2/${id}.json` : `${BASE}/${id}.json`;
  let p = areaCache.get(url);
  if (!p) {
    p = getJson<AoiData>(url);
    p.catch(() => areaCache.delete(url));
    areaCache.set(url, p);
  }
  return p;
}

const metaCache = new Map<string, Promise<GridMeta>>();

/** Small meta file (cells, weeks, links): enough to find which grid covers a drawn rectangle. */
export function loadGridMeta(id: string): Promise<GridMeta> {
  let p = metaCache.get(id);
  if (!p) {
    p = getJson<GridMeta>(`${BASE}/${id}.meta.json`);
    p.catch(() => metaCache.delete(id));
    metaCache.set(id, p);
  }
  return p;
}

const gridCache = new Map<string, Promise<Grid>>();

/** Grid = meta JSON + Uint16 counts (gzip). Africa is ~100 MB once unpacked, so grids load only on demand and once. */
export function loadGrid(id: string): Promise<Grid> {
  let p = gridCache.get(id);
  if (!p) {
    p = (async () => {
      const meta = await loadGridMeta(id);
      const r = await fetch(`${BASE}/${id}.bin.gz`, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`${id}.bin.gz: HTTP ${r.status}`);
      const ab = await r.arrayBuffer();
      const u8 = new Uint8Array(ab);
      let buf = ab;
      if (u8[0] === 0x1f && u8[1] === 0x8b) {
        // Still gzip-compressed (a server may already have decompressed it).
        if (!('DecompressionStream' in window)) throw new Error('DecompressionStream');
        buf = await new Response(new Blob([ab]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      }
      return K367.makeGrid(meta, new Uint16Array(buf));
    })();
    p.catch(() => gridCache.delete(id));
    gridCache.set(id, p);
  }
  return p;
}
