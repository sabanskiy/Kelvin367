// 0.5° grid cells on the History map, recoloured per week without rebuilding (one shared canvas).
import L from 'leaflet';
import type { Grid } from '../../lib/chain';
import { seqColor } from './model';

export class CellLayer {
  private renderer: L.Canvas;
  private group: L.LayerGroup;
  private rects: L.Rectangle[] = [];
  private selected: L.Rectangle | null = null;

  constructor(map: L.Map, private onCell: (k: number, latlng: L.LatLng) => void) {
    this.renderer = L.canvas({ pane: 'cells', padding: 0.3, tolerance: 2 });
    this.group = L.layerGroup().addTo(map);
  }

  /** Build one rectangle per drawn cell (index k into `cells`). */
  setCells(grid: Grid | null, cells: number[]): void {
    this.group.clearLayers();
    this.rects = [];
    this.selected = null;
    if (!grid) return;
    const deg = grid.meta.deg;
    cells.forEach((c, k) => {
      const [iy, ix] = grid.meta.cells[c];
      const r = L.rectangle(
        [
          [iy * deg, ix * deg],
          [(iy + 1) * deg, (ix + 1) * deg],
        ],
        { renderer: this.renderer, weight: 0.6, color: 'rgba(255,255,255,0.65)', fillOpacity: 0, fillColor: '#fff7e6', interactive: true },
      );
      r.on('click', (e) => this.onCell(k, (e as L.LeafletMouseEvent).latlng));
      this.group.addLayer(r);
      this.rects.push(r);
    });
  }

  /** Colour cells by value on a fixed square-root scale; empty cells stay faint so the area shape remains visible. */
  setValues(values: Float64Array, vmax: number): void {
    for (let k = 0; k < this.rects.length; k++) {
      const v = values[k] ?? 0;
      this.rects[k].setStyle(v > 0 ? { fillColor: seqColor(v, vmax), fillOpacity: 0.85 } : { fillColor: '#fff7e6', fillOpacity: 0.18 });
    }
  }

  select(k: number | null): void {
    this.selected?.setStyle({ weight: 0.6, color: 'rgba(255,255,255,0.65)' });
    this.selected = k == null ? null : this.rects[k] ?? null;
    this.selected?.setStyle({ weight: 2.5, color: '#0a2540' });
    this.selected?.bringToFront();
  }

  bounds(): L.LatLngBounds | null {
    if (!this.rects.length) return null;
    const b = L.latLngBounds([]);
    for (const r of this.rects) b.extend(r.getBounds());
    return b;
  }

  destroy(): void {
    this.group.remove();
  }
}
