import { describe, expect, it } from 'vitest';
import { forecastHash, historyHash, parseHash } from './hashState';

describe('parseHash', () => {
  it('opens History for an empty hash', () => {
    expect(parseHash('').tab).toBe('history');
    expect(parseHash('#').tab).toBe('history');
  });

  it('reads legacy links of the old map as Forecast', () => {
    const p = parseHash('#d:2026-08-01..2026-08-15;b:2025-08-01..2025-08-15;l:modis,viirs-noaa20;@12.50,42.50,6z;c:ITA');
    expect(p.tab).toBe('forecast');
    expect(p.forecast).toEqual({
      from: '2026-08-01',
      to: '2026-08-15',
      compare: { from: '2025-08-01', to: '2025-08-15' },
      layers: ['modis', 'viirs-noaa20'],
      view: { center: [42.5, 12.5], zoom: 6 },
      country: 'ITA',
    });
  });

  it('round-trips the Forecast state', () => {
    const s = {
      from: '2026-11-01',
      to: '2026-11-03',
      compare: null,
      layers: ['viirs-noaa20'],
      view: { center: [48.1, 28.3] as [number, number], zoom: 5 },
      bbox: [22, 44, 40.5, 52.5] as [number, number, number, number],
    };
    const p = parseHash(forecastHash(s));
    expect(p.tab).toBe('forecast');
    expect(p.forecast).toEqual({ from: s.from, to: s.to, layers: s.layers, view: s.view, bbox: s.bbox });
  });

  it('round-trips the History state', () => {
    const s = {
      area: 'south_africa',
      mode: 'raw' as const,
      cal: 'unusual' as const,
      week: '2024-06-24',
      bbox: [-9.5, 36, -6, 39] as [number, number, number, number],
      view: { center: [40, -4] as [number, number], zoom: 6 },
    };
    const p = parseHash(historyHash(s));
    expect(p.tab).toBe('history');
    expect(p.history).toEqual(s);
  });

  it('ignores malformed parts', () => {
    const p = parseHash('#history;a:Spain!;w:2024-13;r:1,2,x,4;m:other');
    expect(p.history).toEqual({});
  });
});
