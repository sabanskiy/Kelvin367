// The model forecast on the Forecast map: one rectangle per model cell on a shared canvas in the `cells`
// pane, below the live detections (`hotspots`). Cells are not interactive: the hotspot canvas above would
// swallow their clicks, so the tab finds the cell for a map click with cellAt() (as AreaSelector does).
import L from 'leaflet';
import { ramp, SEQ } from '../history/model';
import { outlookClass, OUTLOOK_BREAKS, type OutlookFile } from './outlook';

const CLASS_T = [0, 0.25, 0.42, 0.6, 0.8, 1];

/** Fill colour of probability class k (1..5); class 0 has no fill. */
export const outlookColor = (k: number) => ramp(SEQ, CLASS_T[Math.max(1, Math.min(OUTLOOK_BREAKS.length, k))]);

const FAINT: L.PathOptions = { weight: 0.5, color: 'rgba(255,255,255,0.45)', fillOpacity: 0 };
const SELECTED: L.PathOptions = { weight: 2.5, color: '#0a2540' };

export class OutlookLayer {
  private renderer: L.Canvas;
  private group: L.LayerGroup;
  private rects: L.Rectangle[] = [];
  private index = new Map<string, number>();
  private selected: number | null = null;
  private day = 0;

  constructor(private map: L.Map, private data: OutlookFile) {
    this.renderer = L.canvas({ pane: 'cells', padding: 0.3 });
    this.group = L.layerGroup();
    data.cells.forEach((c, k) => {
      const [w, s, e, n] = c.bbox_wsen;
      this.rects.push(L.rectangle([[s, w], [n, e]], { renderer: this.renderer, interactive: false, ...FAINT }));
      this.index.set(`${c.cell_y},${c.cell_x}`, k);
    });
    this.rects.forEach((r) => this.group.addLayer(r));
  }

  setVisible(on: boolean): void {
    if (on) this.group.addTo(this.map);
    else this.group.remove();
  }

  /** Recolour for day index `day` (into data.days). */
  setDay(day: number): void {
    this.day = day;
    const p = this.data.series.noaa20_detection_probability[day] ?? [];
    this.rects.forEach((r, k) => {
      const c = outlookClass(p[k]);
      r.setStyle(c === 0 ? FAINT : { weight: 0.5, color: 'rgba(255,255,255,0.6)', fillColor: outlookColor(c), fillOpacity: 0.75 });
    });
    this.restyleSelected();
  }

  /** Cell index under a map position, or null outside the model grid. */
  cellAt(latlng: L.LatLng): number | null {
    const d = this.data.cell_degrees;
    return this.index.get(`${Math.floor(latlng.lat / d)},${Math.floor(latlng.lng / d)}`) ?? null;
  }

  select(k: number | null): void {
    const prev = this.selected;
    this.selected = k;
    if (prev != null) this.setDay(this.day); // restore the previous cell's own style
    this.restyleSelected();
  }

  private restyleSelected(): void {
    if (this.selected == null) return;
    const r = this.rects[this.selected];
    r?.setStyle(SELECTED);
    r?.bringToFront();
  }

  bounds(): L.LatLngBounds {
    const [w, s, e, n] = this.data.bbox_wsen;
    return L.latLngBounds([s, w], [n, e]);
  }

  destroy(): void {
    this.group.remove();
  }
}
