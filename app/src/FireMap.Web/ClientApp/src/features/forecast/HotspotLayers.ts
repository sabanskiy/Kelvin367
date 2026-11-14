// Hot spot layers. Each backend layer (sensor) holds one data "slot" per time period:
//   normal mode  → one period (A), points use the layer colour;
//   compare mode → two periods (A, B), points use the period colour.
// All slots draw on one shared canvas. Layers come from /api/layers, so a new backend provider
// (e.g. harmonized data) appears here automatically.
import L from 'leaflet';
import { api, ApiError, type AppConfig, type HotspotCollection, type HotspotFeature, type LayerDef } from '../../lib/api';
import { boundsToBbox, snapBbox, tileCount, type Bbox } from '../../lib/geo';
import type { Translate } from '../../i18n';

/**
 * Optional per-layer style overrides, keyed by layer id.
 * Example for the team's harmonized layer:
 *   'harmonized-modis-eq': { stroke: '#002b36', minRadius: 3 }
 */
export const LAYER_STYLES: Record<string, Partial<Style>> = {};

const BROWSER_CACHE_SIZE = 30;
const RELOAD_DEBOUNCE_MS = 400;

export interface Period {
  key: 'A' | 'B';
  from: string;
  to: string;
  color: string;
  label: string;
}

export type Selection = { type: 'bbox'; bbox: Bbox } | { type: 'country'; iso3: string; name: string };

/** One timeline day per period ({ A: 'yyyy-mm-dd', B: ... }), or null for all days. */
export type Days = Partial<Record<Period['key'], string | null>> | null;

export type SlotStatus =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'zoom'; tiles?: number; maxTiles?: number; message?: string }
  | { state: 'error'; message: string }
  | { state: 'ok'; count: number; total: number; truncated: boolean; partial: boolean; shown: number };

export type LayerStatus =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'zoom'; tiles?: number; maxTiles?: number; message?: string }
  | { state: 'error'; message: string }
  | {
      state: 'ok';
      truncated: boolean;
      count?: number;
      total: number;
      partial: boolean;
      day: boolean;
      parts: { key: Period['key']; color: string; shown: number; total: number }[];
    };

interface Style {
  fill: string;
  stroke: string;
  weight: number;
  fillOpacity: number;
  minRadius: number;
  maxRadius: number;
}

interface Slot {
  key: Period['key'];
  group: L.FeatureGroup;
  url: string | null;
  controller: AbortController | null;
  data: HotspotCollection | null;
  markers: L.CircleMarker[] | null;
  byDay: Map<string, L.CircleMarker[]> | null;
  status: SlotStatus;
}

interface Layer {
  def: LayerDef;
  enabled: boolean;
  status: LayerStatus;
  slots: Map<Period['key'], Slot>;
}

type FeatureMarker = L.CircleMarker & { hotspot?: HotspotFeature };

export interface HotspotHooks {
  onStatus?: (id: string, status: LayerStatus, comparing: boolean) => void;
  onLoadingChange?: (names: string[]) => void;
  onData?: () => void;
}

export class HotspotLayers {
  private renderer: L.Canvas;
  private layers = new Map<string, Layer>();
  private periods: Period[] = [];
  private cache = new Map<string, HotspotCollection>(); // url → response (LRU)
  private config: AppConfig | null = null;
  private filter: Selection | null = null; // limits points to the selection
  private days: Days = null; // timeline day per period; null = show every day
  private timer: ReturnType<typeof setTimeout> | undefined;
  popupsEnabled = true;
  t: Translate = (k) => k;

  constructor(private map: L.Map, private hooks: HotspotHooks) {
    this.renderer = L.canvas({ pane: 'hotspots', padding: 0.3, tolerance: 3 });
  }

  get comparing(): boolean {
    return this.periods.length > 1;
  }

  init(config: AppConfig, defs: LayerDef[], enabledIds: Set<string>): void {
    this.config = config;
    for (const def of defs) {
      this.layers.set(def.id, { def, enabled: enabledIds.has(def.id), status: { state: 'idle' }, slots: new Map() });
    }
    this.map.on('moveend', () => this.reload());
  }

  /** Periods to show: one (normal) or two (comparison). Replaces the previous set. */
  setPeriods(periods: Period[]): void {
    this.periods = periods.map((p) => ({ ...p }));
    const keys = new Set(this.periods.map((p) => p.key));
    for (const l of this.layers.values()) {
      for (const [key, slot] of l.slots) {
        if (!keys.has(key)) {
          this.dropSlot(slot);
          l.slots.delete(key);
        }
      }
      for (const p of this.periods) {
        if (!l.slots.has(p.key)) l.slots.set(p.key, this.newSlot(l, p.key));
        l.slots.get(p.key)!.url = null; // range or colouring may have changed → re-render (browser cache makes it cheap)
      }
    }
    this.reload(0);
    this.hooks.onData?.();
  }

  setEnabled(id: string, enabled: boolean): void {
    const l = this.layers.get(id);
    if (!l) return;
    l.enabled = enabled;
    for (const slot of l.slots.values()) {
      if (enabled) {
        slot.group.addTo(this.map);
        void this.load(l, slot);
      } else {
        slot.controller?.abort();
        slot.group.remove();
        slot.status = { state: 'idle' };
      }
    }
    this.emitStatus(l);
    this.hooks.onData?.(); // per-day counts changed
  }

  /** Show only points inside the selection (null = everything in the current view). */
  setFilter(selection: Selection | null): void {
    this.filter = selection ? { ...selection } : null;
    for (const l of this.layers.values()) for (const slot of l.slots.values()) slot.url = null;
    this.reload(0);
  }

  /** Timeline: one UTC day per period, or null for all days. No refetch. */
  setDays(days: Days): void {
    this.days = days;
    this.drawAll();
  }

  /** Detections per day and period across enabled layers: { A: Map(day → n), B: ... }. */
  dayCounts(): Partial<Record<Period['key'], Map<string, number>>> {
    const out: Partial<Record<Period['key'], Map<string, number>>> = Object.fromEntries(this.periods.map((p) => [p.key, new Map()]));
    for (const l of this.layers.values()) {
      if (!l.enabled) continue;
      for (const [key, slot] of l.slots) {
        const target = out[key];
        if (!slot.byDay || !target) continue;
        for (const [day, markers] of slot.byDay) target.set(day, (target.get(day) ?? 0) + markers.length);
      }
    }
    return out;
  }

  reload(delay = RELOAD_DEBOUNCE_MS): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      for (const l of this.layers.values()) {
        if (l.enabled) for (const slot of l.slots.values()) void this.load(l, slot);
      }
    }, delay);
  }

  destroy(): void {
    clearTimeout(this.timer);
    for (const l of this.layers.values()) for (const slot of l.slots.values()) this.dropSlot(slot);
  }

  // ---- internals ----------------------------------------------------------------------------

  /** Redraw every loaded slot. In compare mode B goes first so period A stays on top of the shared canvas. */
  private drawAll(): void {
    const order = [...this.periods].reverse().map((p) => p.key);
    for (const key of order) {
      for (const l of this.layers.values()) {
        const slot = l.enabled ? l.slots.get(key) : undefined;
        if (slot?.data) this.draw(l, slot);
      }
    }
  }

  private period(key: Period['key']): Period | undefined {
    return this.periods.find((p) => p.key === key);
  }

  private newSlot(l: Layer, key: Period['key']): Slot {
    const group = L.featureGroup();
    group.on('click', (e) => this.openPopup(l.def, key, e as L.LeafletMouseEvent & { layer: FeatureMarker }));
    if (l.enabled) group.addTo(this.map);
    return { key, group, url: null, controller: null, data: null, markers: null, byDay: null, status: { state: 'idle' } };
  }

  private dropSlot(slot: Slot): void {
    slot.controller?.abort();
    slot.group.remove();
  }

  private async load(l: Layer, slot: Slot): Promise<void> {
    const period = this.period(slot.key);
    if (!period || !this.config) return;
    const { from, to } = period;
    let url: string;

    if (this.filter) {
      // Selection filter: fixed area, independent of the map view (panning does not reload).
      const area = this.filter.type === 'country' ? { country: this.filter.iso3 } : { bbox: this.filter.bbox };
      url = api.hotspotsUrl({ layer: l.def.id, ...area, from, to });
    } else {
      // Snap to a fine grid so small pans reuse the same URL; the server fetches whole (coarser) cache tiles.
      const bbox = snapBbox(boundsToBbox(this.map.getBounds()), this.config.requestGridDeg);
      const tiles = tileCount(bbox, this.config.tileSizeDeg);
      if (tiles > this.config.mapMaxTiles) {
        slot.controller?.abort();
        slot.url = null;
        this.forget(slot);
        slot.status = { state: 'zoom', tiles, maxTiles: this.config.mapMaxTiles };
        this.emitStatus(l);
        this.hooks.onData?.();
        return;
      }
      url = api.hotspotsUrl({ layer: l.def.id, bbox, from, to });
    }

    // Same request already shown or in flight (pan inside the same tiles, or any pan while filtered).
    if (url === slot.url && slot.status.state !== 'idle') return;

    slot.controller?.abort();
    slot.url = url;

    const cached = this.cache.get(url);
    if (cached) {
      this.cache.delete(url); // refresh LRU position
      this.cache.set(url, cached);
      this.render(l, slot, cached);
      return;
    }

    const controller = new AbortController();
    slot.controller = controller;
    slot.status = { state: 'loading' };
    this.emitStatus(l);
    try {
      const data = await api.hotspots(url, controller.signal);
      if (controller.signal.aborted || slot.url !== url) return;
      if (!data.partial) this.remember(url, data); // never pin incomplete answers
      this.render(l, slot, data);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      this.forget(slot);
      const zoom = err instanceof ApiError && err.status === 422 && !this.filter;
      slot.status = zoom ? { state: 'zoom', message: (err as Error).message } : { state: 'error', message: (err as Error).message };
      this.emitStatus(l);
      this.hooks.onData?.();
    } finally {
      if (slot.controller === controller) slot.controller = null;
    }
  }

  private render(l: Layer, slot: Slot, data: HotspotCollection): void {
    // Markers are built once per response and indexed by day, so timeline steps only swap which are drawn.
    const periodColor = this.comparing ? this.period(slot.key)?.color : null;
    const periodStyle: Partial<Style> = periodColor ? { fill: periodColor, ...(slot.key !== 'A' ? { fillOpacity: 0.7 } : {}) } : {};
    const style: Style = { ...defaultStyle(l.def), ...(LAYER_STYLES[l.def.id] ?? {}), ...periodStyle };
    const all: FeatureMarker[] = [];
    const byDay = new Map<string, FeatureMarker[]>();
    for (const f of data.features) {
      const [lon, lat] = f.geometry.coordinates;
      const marker: FeatureMarker = L.circleMarker([lat, lon], {
        renderer: this.renderer,
        radius: radiusFor(f.properties.frp, style),
        color: style.stroke,
        weight: style.weight,
        fillColor: style.fill,
        fillOpacity: style.fillOpacity,
        opacity: 0.9,
      });
      marker.hotspot = f;
      all.push(marker);
      const day = String(f.properties.acquired).slice(0, 10); // acquired is UTC ISO 8601
      let list = byDay.get(day);
      if (!list) byDay.set(day, (list = []));
      list.push(marker);
    }
    slot.data = data;
    slot.markers = all;
    slot.byDay = byDay;
    if (this.comparing) this.drawAll(); // keep A above B whichever finished loading last
    else this.draw(l, slot);
    this.hooks.onData?.();
  }

  private draw(l: Layer, slot: Slot): void {
    if (!slot.data || !slot.markers || !slot.byDay) return;
    let shown = slot.markers;
    if (this.days) {
      const day = this.days[slot.key];
      shown = day ? slot.byDay.get(day) ?? [] : []; // a shorter period has no day at this timeline step
    }
    slot.group.clearLayers();
    for (const m of shown) slot.group.addLayer(m);
    slot.status = {
      state: 'ok',
      count: slot.data.features.length,
      total: slot.data.totalCount,
      truncated: slot.data.truncated,
      partial: slot.data.partial,
      shown: shown.length,
    };
    this.emitStatus(l);
  }

  private forget(slot: Slot): void {
    slot.data = null;
    slot.markers = null;
    slot.byDay = null;
    slot.group.clearLayers();
  }

  /** Combine the per-period slot states into one status for the layer list / banner. */
  private emitStatus(l: Layer): void {
    const parts = this.periods.map((p) => ({ period: p, s: l.slots.get(p.key)?.status ?? ({ state: 'idle' } as SlotStatus) }));
    const states = parts.map((x) => x.s);
    const error = states.find((s): s is Extract<SlotStatus, { state: 'error' }> => s.state === 'error');
    const zoom = states.find((s): s is Extract<SlotStatus, { state: 'zoom' }> => s.state === 'zoom');
    let status: LayerStatus;
    if (!l.enabled || states.length === 0) status = { state: 'idle' };
    else if (states.some((s) => s.state === 'loading')) status = { state: 'loading' };
    else if (error) status = { ...error };
    else if (zoom) status = { ...zoom };
    else if (states.every((s) => s.state === 'ok')) {
      const oks = states as Extract<SlotStatus, { state: 'ok' }>[];
      const truncated = oks.find((s) => s.truncated);
      status = {
        state: 'ok',
        truncated: !!truncated,
        count: truncated?.count,
        total: truncated?.total ?? oks[0].total,
        partial: oks.some((s) => s.partial),
        day: !!this.days,
        parts: parts.map(({ period, s }) => {
          const ok = s as Extract<SlotStatus, { state: 'ok' }>;
          return { key: period.key, color: period.color, shown: ok.shown, total: ok.total };
        }),
      };
    } else status = { state: 'idle' };

    l.status = status;
    this.hooks.onStatus?.(l.def.id, status, this.comparing);
    const loading = [...this.layers.values()].filter((x) => x.enabled && x.status.state === 'loading').map((x) => x.def.name);
    this.hooks.onLoadingChange?.(loading);
  }

  private openPopup(def: LayerDef, periodKey: Period['key'], e: L.LeafletMouseEvent & { layer: FeatureMarker }): void {
    if (!this.popupsEnabled) return;
    const f = e.layer.hotspot;
    if (!f) return;
    const period = this.period(periodKey);
    const head =
      this.comparing && period
        ? { color: period.color, title: this.t('popup.period', { name: def.name, k: period.key, label: period.label }) }
        : { color: def.color, title: def.name };
    L.popup({ maxWidth: 300, className: 'hs-popup' }).setLatLng(e.latlng).setContent(popupHtml(head, f, this.t)).openOn(this.map);
  }

  private remember(url: string, data: HotspotCollection): void {
    this.cache.set(url, data);
    while (this.cache.size > BROWSER_CACHE_SIZE) this.cache.delete(this.cache.keys().next().value as string);
  }
}

function defaultStyle(def: LayerDef): Style {
  return { fill: def.color, stroke: 'rgba(20, 12, 8, 0.75)', weight: 0.6, fillOpacity: 0.88, minRadius: 2.5, maxRadius: 9 };
}

/** Radius grows with log(FRP) so strong fires stand out without hiding weak ones. */
function radiusFor(frp: number | null, style: Style): number {
  const r = style.minRadius + Math.log10(1 + (frp || 0)) * 2.2;
  return Math.min(style.maxRadius, Math.max(style.minRadius, r));
}

const fmt = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined ? '–' : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits });

function popupHtml(head: { color: string; title: string }, f: HotspotFeature, t: Translate): string {
  const p = f.properties;
  const [lon, lat] = f.geometry.coordinates;
  const when = new Date(p.acquired).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const conf = p.confidencePct != null ? `${p.confidence} (${p.confidencePct}%)` : p.confidence;
  const rows: [string, string][] = [
    [t('popup.acquired'), when],
    [t('popup.satellite'), `${p.satellite} · ${p.instrument}`],
    [t('popup.frp'), `${fmt(p.frp)} MW`],
    [t('popup.confidence'), conf],
    [t('popup.brightness'), `${fmt(p.brightness)} K`],
    [t('popup.dayNight'), p.dayNight === 'D' ? t('popup.day') : p.dayNight === 'N' ? t('popup.night') : '–'],
    [t('popup.pixel'), p.scan && p.track ? `${fmt(p.scan, 2)} × ${fmt(p.track, 2)} km` : '–'],
    [t('popup.location'), `${lat.toFixed(4)}, ${lon.toFixed(4)}`],
    [t('popup.source'), p.source],
  ];
  return `
    <div class="popup-head"><span class="swatch" style="--c:${escapeHtml(head.color)}"></span>${escapeHtml(head.title)}</div>
    <dl class="popup-grid">${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v ?? '–'))}</dd>`).join('')}</dl>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
