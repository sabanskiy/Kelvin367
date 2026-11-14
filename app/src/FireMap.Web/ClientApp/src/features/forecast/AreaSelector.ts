// Area selection: draw a rectangle (Leaflet-Geoman) or pick a country (click / search).
// Country hit-testing is JS point-in-polygon on map events, because the points canvas would swallow
// events meant for country polygons.
import L from 'leaflet';
import { featureBbox, featureContains, roundBbox, wrapLon, type Bbox, type CountryCollection, type CountryFeature } from '../../lib/geo';
import type { Selection } from './HotspotLayers';

const SELECTED_STYLE: L.PathOptions = { color: '#ffb703', weight: 2.5, fillColor: '#ffb703', fillOpacity: 0.07 };
const HOVER_STYLE: L.PathOptions = { color: '#ffffff', weight: 1.5, dashArray: '4 4', fill: true, fillColor: '#ffffff', fillOpacity: 0.08 };
const OUTLINE_STYLE: L.PathOptions = { color: '#5b6b80', weight: 0.7, opacity: 0.7, fill: false };

export type SelectMode = 'rect' | 'country' | null;

interface Country {
  feature: CountryFeature;
  bbox: Bbox;
  iso3: string;
  name: string;
}

export interface AreaSelectorHooks {
  onSelect: (sel: Selection) => void;
  onClear: () => void;
  onModeChange: (mode: SelectMode) => void;
}

export class AreaSelector {
  mode: SelectMode = null;
  private countries: Country[] = [];
  private selected: L.Layer | null = null;
  private selectionKind: 'bbox' | 'country' | null = null;
  private hover: L.Layer | null = null;
  private hoverIso: string | null = null;
  private outlines: L.GeoJSON | null = null;
  private raf = 0;
  private onKey = (e: KeyboardEvent) => e.key === 'Escape' && this.setMode(null);

  constructor(private map: L.Map, private hooks: AreaSelectorHooks) {
    map.pm.setGlobalOptions({ panes: { layerPane: 'selection', vertexPane: 'markerPane', markerPane: 'markerPane' } } as L.PM.GlobalOptions);
    map.on('pm:create', (e) => this.onRectangleCreated(e as unknown as { shape: string; layer: L.Rectangle }));
    map.on('pm:drawend', () => this.mode === 'rect' && this.setMode(null));
    document.addEventListener('keydown', this.onKey);
  }

  destroy(): void {
    document.removeEventListener('keydown', this.onKey);
  }

  setCountries(geojson: CountryCollection): void {
    this.countries = geojson.features.map((f) => ({ feature: f, bbox: featureBbox(f), iso3: f.properties.iso3, name: f.properties.name }));
    this.outlines = L.geoJSON(geojson as GeoJSON.FeatureCollection, {
      pane: 'countries',
      interactive: false,
      style: OUTLINE_STYLE,
      renderer: L.canvas({ pane: 'countries' }),
    } as L.GeoJSONOptions);
  }

  countryList(): { iso3: string; name: string }[] {
    return this.countries.map((c) => ({ iso3: c.iso3, name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
  }

  findByName(name: string): { iso3: string; name: string } | undefined {
    const n = name.trim().toLowerCase();
    return this.countries.find((c) => c.name.toLowerCase() === n);
  }

  get selectionType(): 'bbox' | 'country' | null {
    return this.selectionKind;
  }

  /** "Draw rectangle" button: a second press removes the rectangle; otherwise replaces any country and starts drawing. */
  toggleRectangle(): void {
    if (this.mode === 'rect' || this.selectionKind === 'bbox') return this.clear();
    if (this.selectionKind || this.mode) this.clear();
    this.setMode('rect');
  }

  /** "Pick country" button: a second press removes the country; otherwise replaces any rectangle and starts picking. */
  toggleCountry(): void {
    if (this.mode === 'country' || this.selectionKind === 'country') return this.clear();
    if (this.selectionKind || this.mode) this.clear();
    this.setMode('country');
  }

  setMode(mode: SelectMode): void {
    if (this.mode === mode) return;
    const old = this.mode;
    this.mode = mode; // set first: disableDraw() fires pm:drawend synchronously
    if (old === 'rect') this.map.pm.disableDraw();
    if (old === 'country') {
      this.map.off('mousemove', this.onMove);
      this.map.off('click', this.onClick);
      this.outlines?.remove();
      this.clearHover();
      this.map.getContainer().classList.remove('picking');
    }
    if (mode === 'rect') {
      this.map.pm.enableDraw('Rectangle', {
        snappable: false,
        cursorMarker: false,
        pathOptions: SELECTED_STYLE,
        templineStyle: SELECTED_STYLE,
        hintlineStyle: { ...SELECTED_STYLE, dashArray: '4 4' },
      } as L.PM.DrawModeOptions);
    } else if (mode === 'country') {
      this.outlines?.addTo(this.map);
      this.map.on('mousemove', this.onMove);
      this.map.on('click', this.onClick);
      this.map.getContainer().classList.add('picking');
    }
    this.hooks.onModeChange(mode);
  }

  selectCountry(iso3: string, { fit = true } = {}): void {
    const c = this.countries.find((x) => x.iso3 === iso3);
    if (!c) return;
    this.setMode(null);
    this.clearSelection(); // replaces a rectangle or another country
    this.selectionKind = 'country';
    const layer = L.geoJSON(c.feature as GeoJSON.Feature, { pane: 'selection', interactive: false, style: SELECTED_STYLE } as L.GeoJSONOptions).addTo(this.map);
    this.selected = layer;
    if (fit) this.map.fitBounds(layer.getBounds(), { padding: [30, 30], maxZoom: 7 });
    this.hooks.onSelect({ type: 'country', iso3: c.iso3, name: c.name });
  }

  selectBbox(bbox: Bbox, { fit = false } = {}): void {
    this.setMode(null);
    this.clearSelection(); // replaces a country or another rectangle
    this.selectionKind = 'bbox';
    const [w, s, e, n] = bbox;
    const rect = L.rectangle([[s, w], [n, e]], { pane: 'selection', ...SELECTED_STYLE }).addTo(this.map);
    this.selected = rect;
    rect.pm?.enable({ snappable: false, draggable: false } as L.PM.EditModeOptions);
    rect.on('pm:edit', () => this.hooks.onSelect({ type: 'bbox', bbox: boundsBbox(rect.getBounds()) }));
    if (fit) this.map.fitBounds(rect.getBounds(), { padding: [30, 30] });
    this.hooks.onSelect({ type: 'bbox', bbox });
  }

  clear(): void {
    this.setMode(null);
    const had = !!this.selectionKind;
    this.clearSelection();
    if (had) this.hooks.onClear();
  }

  // ---- internals ----------------------------------------------------------------------------

  private onRectangleCreated(e: { shape: string; layer: L.Rectangle }): void {
    if (e.shape !== 'Rectangle') return;
    const bbox = boundsBbox(e.layer.getBounds());
    e.layer.remove(); // re-created by selectBbox so all selections share one code path
    this.setMode(null);
    this.selectBbox(bbox);
  }

  private countryAt(latlng: L.LatLng): Country | undefined {
    const lon = wrapLon(latlng.lng), lat = latlng.lat;
    return this.countries.find(
      (c) => lon >= c.bbox[0] && lon <= c.bbox[2] && lat >= c.bbox[1] && lat <= c.bbox[3] && featureContains(c.feature, lon, lat),
    );
  }

  private onMove = (e: L.LeafletMouseEvent) => {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => {
      const c = this.countryAt(e.latlng);
      if (c?.iso3 === this.hoverIso) return;
      this.clearHover();
      if (!c) return;
      this.hoverIso = c.iso3;
      this.hover = L.geoJSON(c.feature as GeoJSON.Feature, { pane: 'selection', interactive: false, style: HOVER_STYLE } as L.GeoJSONOptions).addTo(this.map);
      this.map.getContainer().title = c.name;
    });
  };

  private onClick = (e: L.LeafletMouseEvent) => {
    const c = this.countryAt(e.latlng);
    if (!c) return;
    this.setMode(null);
    this.selectCountry(c.iso3, { fit: true });
  };

  private clearHover(): void {
    this.hover?.remove();
    this.hover = null;
    this.hoverIso = null;
    this.map.getContainer().title = '';
  }

  private clearSelection(): void {
    if (this.selected) {
      (this.selected as L.Layer & { pm?: { disable(): void } }).pm?.disable();
      this.selected.remove();
    }
    this.selected = null;
    this.selectionKind = null;
  }
}

/** Rectangle bounds → bbox. The map may be scrolled onto a world copy: shift by whole turns, keep the width. */
export function boundsBbox(b: L.LatLngBounds): Bbox {
  const w = wrapLon(b.getWest());
  const e = w + (b.getEast() - b.getWest());
  return roundBbox([Math.max(-180, w), Math.max(-90, b.getSouth()), Math.min(180, e), Math.min(90, b.getNorth())]);
}
