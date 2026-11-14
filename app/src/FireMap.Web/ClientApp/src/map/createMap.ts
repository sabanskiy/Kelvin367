// Leaflet map with the base layers already used by the project (OSM, Esri) and the panes that keep
// layers in a predictable order. Each tab owns one map; the viewport is handed over on tab switch.
// CARTO basemaps are not offered: they now need an API key (unkeyed tiles carry a watermark).
import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import type { MapView } from '../lib/hashState';

const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export interface AppMap {
  map: L.Map;
  destroy(): void;
}

export function createMap(el: HTMLElement, view: MapView): AppMap {
  const map = L.map(el, {
    zoomControl: false,
    worldCopyJump: true,
    minZoom: 2,
    maxBounds: [[-90, -540], [90, 540]],
  }).setView(view.center, view.zoom);

  L.control.zoom({ position: 'topright' }).addTo(map);
  L.control.scale({ position: 'bottomright', imperial: false }).addTo(map);

  // In the dark theme the OSM tiles are inverted by CSS (.tiles-themed in styles/index.css).
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: OSM_ATTR, className: 'tiles-themed' });
  const baseLayers: Record<string, L.TileLayer> = {
    OpenStreetMap: osm,
    'Satellite (Esri)': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
    }),
  };
  osm.addTo(map);

  // Pane order (bottom → top): tiles 200 · cells 370 · countries 380 · selection 390 · hotspots 420 · markers 600 · popups 700
  addPane(map, 'cells', 370, false);
  addPane(map, 'countries', 380, true);
  addPane(map, 'selection', 390, true);
  addPane(map, 'hotspots', 420, false);

  L.control.layers(baseLayers, {}, { position: 'topright', collapsed: true }).addTo(map);

  return {
    map,
    destroy() {
      map.remove();
    },
  };
}

function addPane(map: L.Map, name: string, zIndex: number, passThrough: boolean) {
  const pane = map.createPane(name);
  pane.style.zIndex = String(zIndex);
  if (passThrough) pane.style.pointerEvents = 'none';
  return pane;
}

export function viewOf(map: L.Map): MapView {
  const c = map.getCenter();
  return { center: [c.lat, c.lng], zoom: map.getZoom() };
}
