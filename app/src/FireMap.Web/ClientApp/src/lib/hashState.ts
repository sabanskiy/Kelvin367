// URL hash = shareable state of the active tab.
//   #history;a:spain;m:raw;v:unusual;w:2024-06-24;r:-9.5,36,-6,39;@-4.00,40.00,6z
//   #forecast;d:2026-08-01..2026-08-15;b:2025-08-01..2025-08-15;l:modis,viirs-noaa20;@12.50,42.50,6z;c:ITA
// Links from the old single-page map have no tab prefix ("#d:…") and open the Forecast tab.
import type { Bbox } from './geo';

export type Tab = 'history' | 'forecast';

export interface MapView {
  center: [lat: number, lng: number];
  zoom: number;
}

export interface Range {
  from: string;
  to: string;
}

export interface ForecastHash {
  from?: string;
  to?: string;
  compare?: Range;
  layers?: string[];
  view?: MapView;
  country?: string;
  bbox?: Bbox;
}

export type HistoryMode = 'harm' | 'raw';
export type CalendarView = 'counts' | 'unusual';

export interface HistoryHash {
  area?: string;
  mode?: HistoryMode;
  cal?: CalendarView;
  week?: string;
  bbox?: Bbox;
  view?: MapView;
}

export interface ParsedHash {
  tab: Tab;
  forecast: ForecastHash;
  history: HistoryHash;
}

const RANGE = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseView(part: string): MapView | undefined {
  const m = part.match(/^@(-?[\d.]+),(-?[\d.]+),([\d.]+)z$/);
  return m ? { center: [Number(m[2]), Number(m[1])], zoom: Number(m[3]) } : undefined;
}

function parseBbox(s: string): Bbox | undefined {
  const b = s.split(',').map(Number);
  return b.length === 4 && b.every(Number.isFinite) ? (b as Bbox) : undefined;
}

export function parseHash(hash: string): ParsedHash {
  let text = '';
  try {
    text = decodeURIComponent(hash.replace(/^#/, ''));
  } catch {
    text = hash.replace(/^#/, '');
  }
  const parts = text.split(';').filter(Boolean);
  let tab: Tab;
  if (parts[0] === 'history' || parts[0] === 'forecast') tab = parts.shift() as Tab;
  else tab = parts.length ? 'forecast' : 'history'; // legacy "#d:…" links → forecast; empty → history

  const forecast: ForecastHash = {};
  const history: HistoryHash = {};
  for (const part of parts) {
    let m: RegExpMatchArray | null;
    const view = parseView(part);
    if (view) {
      if (tab === 'forecast') forecast.view = view;
      else history.view = view;
      continue;
    }
    if (tab === 'forecast') {
      if (part.startsWith('d:') && (m = part.slice(2).match(RANGE))) [, forecast.from, forecast.to] = m;
      else if (part.startsWith('b:') && (m = part.slice(2).match(RANGE))) forecast.compare = { from: m[1], to: m[2] };
      else if ((m = part.match(/^l:(.*)$/))) forecast.layers = m[1].split(',').filter(Boolean);
      else if ((m = part.match(/^c:([A-Z0-9]{3})$/))) forecast.country = m[1];
      else if ((m = part.match(/^r:(.+)$/))) forecast.bbox = parseBbox(m[1]);
    } else {
      if ((m = part.match(/^a:([a-z_]+)$/))) history.area = m[1];
      else if (part === 'm:raw' || part === 'm:harm') history.mode = part.slice(2) as HistoryMode;
      else if (part === 'v:counts' || part === 'v:unusual') history.cal = part.slice(2) as CalendarView;
      else if ((m = part.match(/^w:(.+)$/)) && DATE.test(m[1])) history.week = m[1];
      else if ((m = part.match(/^r:(.+)$/))) history.bbox = parseBbox(m[1]);
    }
  }
  return { tab, forecast, history };
}

const viewPart = (v: MapView) => `@${v.center[1].toFixed(2)},${v.center[0].toFixed(2)},${v.zoom}z`;

export function forecastHash(s: { from: string; to: string; compare: Range | null; layers: string[]; view?: MapView; country?: string; bbox?: Bbox }): string {
  const parts = ['forecast', `d:${s.from}..${s.to}`];
  if (s.compare) parts.push(`b:${s.compare.from}..${s.compare.to}`);
  parts.push(`l:${s.layers.join(',')}`);
  if (s.view) parts.push(viewPart(s.view));
  if (s.country) parts.push(`c:${s.country}`);
  if (s.bbox) parts.push(`r:${s.bbox.join(',')}`);
  return '#' + parts.join(';');
}

export function historyHash(s: HistoryHash): string {
  const parts = ['history'];
  if (s.area) parts.push(`a:${s.area}`);
  if (s.mode) parts.push(`m:${s.mode}`);
  if (s.cal) parts.push(`v:${s.cal}`);
  if (s.week) parts.push(`w:${s.week}`);
  if (s.bbox) parts.push(`r:${s.bbox.join(',')}`);
  if (s.view) parts.push(viewPart(s.view));
  return '#' + parts.join(';');
}

export function replaceHash(hash: string): void {
  if (location.hash !== hash) history.replaceState(null, '', hash);
}
