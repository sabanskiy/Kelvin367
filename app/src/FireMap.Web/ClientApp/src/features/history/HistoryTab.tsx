// History tab: the harmonized weekly burning calendar (spacechallenge app) in the Figma layout —
// area chooser + draw area, Raw/Harmonized switch, key numbers, calendar, 0.5° cell map and week scrubber.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import L from 'leaflet';
import K367, { type Grid } from '../../lib/chain';
import { featureContains, loadCountries, type Bbox, type CountryCollection, type CountryFeature } from '../../lib/geo';
import { historyHash, replaceHash, type CalendarView, type HistoryHash, type HistoryMode, type MapView } from '../../lib/hashState';
import { useIsMobile, type Theme } from '../../lib/theme';
import { weekLabel } from '../../lib/dates';
import { createMap, viewOf, type AppMap } from '../../map/createMap';
import { boundsBbox } from '../forecast/AreaSelector';
import { useI18n, type MessageKey } from '../../i18n';
import { Icon } from '../../components/Icon';
import { Segmented } from '../../components/Segmented';
import { MetricCard } from '../../components/MetricCard';
import { Scrubber } from '../../components/Scrubber';
import { SidePanel } from '../../components/SidePanel';
import { Calendar } from './Calendar';
import { CellLayer } from './CellLayer';
import { AREA_GEO, DEFAULT_AREA, loadArea, loadGrid, loadGridMeta, loadIndex, loadV2Index, type AreaIndexEntry, type Dataset, type GridIndexEntry, type V2Index } from './data';
import { compareDatasets, type Comparison } from './compare';
import {
  cellKm2,
  cellValues,
  cellVmax,
  divColor,
  hasRaw,
  latestWeek,
  makeCellView,
  percentiles,
  prepare,
  SEQ,
  ramp,
  sensorJump,
  shownSeries,
  toCsv,
  type CellView,
  type Prepared,
} from './model';

const DEFAULT_VIEW: MapView = { center: [40, -4], zoom: 5 };
const SELECTED_STYLE: L.PathOptions = { color: '#533afd', weight: 2, fill: false, dashArray: '6 4' };

interface Custom {
  gridId: string;
  cells: number[];
  bbox: Bbox;
  info: string;
  warnings: string[];
}

export function HistoryTab({
  active,
  theme,
  initial,
  sharedView,
  onViewChange,
  drawerOpen,
  setDrawerOpen,
}: {
  active: boolean;
  theme: Theme;
  initial: HistoryHash;
  sharedView: () => MapView | null;
  onViewChange: (v: MapView) => void;
  /** Mobile drawer state; owned by App so the top bar's Controls button can open it. */
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
}) {
  const { t, nf, locale } = useI18n();
  const isMobile = useIsMobile();
  const mapEl = useRef<HTMLDivElement>(null);
  const appMap = useRef<AppMap | null>(null);
  const cellLayer = useRef<CellLayer | null>(null);
  const outline = useRef<L.Layer | null>(null);
  const fitNext = useRef(!initial.view);

  const [areas, setAreas] = useState<AreaIndexEntry[]>([]);
  const [grids, setGrids] = useState<GridIndexEntry[]>([]);
  const [countries, setCountries] = useState<CountryCollection | null>(null);
  const [areaId, setAreaId] = useState(initial.area ?? DEFAULT_AREA);
  const [custom, setCustom] = useState<Custom | null>(null);
  // A shared link with a custom rectangle: hold the preset back until that area is built (or fails),
  // so the preset does not take the link's week first.
  const [bootPending, setBootPending] = useState(!!initial.bbox);
  const [data, setData] = useState<Prepared | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<HistoryMode>(initial.mode ?? 'harm');
  const [calView, setCalView] = useState<CalendarView>(initial.cal ?? 'counts');
  const [week, setWeek] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [grid, setGrid] = useState<Grid | null>(null);
  const [cellView, setCellView] = useState<CellView | null>(null);
  const [gridLoading, setGridLoading] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [drawMsg, setDrawMsg] = useState<{ kind: 'info' | 'warn'; text: string } | null>(null);
  const [cellPick, setCellPick] = useState<{ k: number; latlng: L.LatLng } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [showAllYears, setShowAllYears] = useState(false);
  const [, setMapTick] = useState(0); // re-render the cell card when the map moves
  const wantWeek = useRef<string | undefined>(initial.week);
  const [v2Index, setV2Index] = useState<V2Index | null>(null);
  const [dataset, setDataset] = useState<Dataset>(initial.dataset ?? 'v1');
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const hasV2 = !custom && !!v2Index?.aois.some((a) => a.id === areaId);
  /** Dataset actually shown: drawn areas and areas without new data always use the current data. */
  const ds: Dataset = hasV2 && dataset === 'v2' ? 'v2' : 'v1';

  // ---- boot ----------------------------------------------------------------------------------------
  useEffect(() => {
    if (!mapEl.current) return;
    const m = createMap(mapEl.current, initial.view ?? sharedView() ?? DEFAULT_VIEW);
    appMap.current = m;
    cellLayer.current = new CellLayer(m.map, (k, latlng) =>
      // a second click on the same cell closes its card
      setCellPick((prev) => (prev?.k === k ? null : { k, latlng })),
    );
    m.map.pm.setGlobalOptions({ panes: { layerPane: 'selection', vertexPane: 'markerPane', markerPane: 'markerPane' } } as L.PM.GlobalOptions);
    Promise.all([loadIndex(), loadCountries()])
      .then(([idx, c]) => {
        setAreas(idx.aois);
        setGrids(idx.grids);
        setCountries(c);
      })
      .catch((e: Error) => setError(t('err.load', { msg: e.message })));
    void loadV2Index().then(setV2Index);
    return () => {
      cellLayer.current?.destroy();
      m.destroy();
      appMap.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- preset area -----------------------------------------------------------------------------------
  useEffect(() => {
    if (custom || bootPending || !countries || areas.length === 0 || !v2Index) return;
    const id = areas.some((a) => a.id === areaId) ? areaId : areas[0].id;
    let cancelled = false;
    setError(null);
    setCellPick(null);
    loadArea(id, ds)
      .then(async (raw) => {
        if (cancelled) return;
        const d = prepare(raw);
        setData(d);
        setWeek(pickWeek(d, wantWeek.current));
        wantWeek.current = undefined;
        if (mode === 'raw' && !hasRaw(d)) setMode('harm');

        const geo = AREA_GEO[id];
        const features = countries.features.filter((f) => geo?.iso3.includes(f.properties.iso3));
        showOutline(features.length ? L.geoJSON({ type: 'FeatureCollection', features } as GeoJSON.FeatureCollection) : null);
        if (!geo?.grid) {
          setGrid(null);
          setCellView(null);
          cellLayer.current?.setCells(null, []);
          fit();
          return;
        }
        setGridLoading(true);
        const g = await loadGrid(geo.grid);
        if (cancelled) return;
        const cells = cellsInCountries(g, features);
        const view = makeCellView(d, g, cells);
        setGrid(g);
        setCellView(view);
        cellLayer.current?.setCells(g, cells);
        fit();
      })
      .catch((e: Error) => !cancelled && setError(t('err.load', { msg: e.message === 'DecompressionStream' ? t('err.decompress') : e.message })))
      .finally(() => !cancelled && setGridLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaId, areas, countries, custom === null, bootPending, v2Index, ds]);

  // Switching the dataset keeps the week and the map view.
  const switchDataset = (next: Dataset) => {
    if (data) wantWeek.current = data.weeks[week];
    fitNext.current = false;
    setDataset(next);
  };

  // Unit-free comparison of the two datasets for the selected preset.
  useEffect(() => {
    setComparison(null);
    if (!hasV2) return;
    let cancelled = false;
    Promise.all([loadArea(areaId, 'v1'), loadArea(areaId, 'v2')])
      .then(([a, b]) => !cancelled && setComparison(compareDatasets(prepare(a), prepare(b))))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [areaId, hasV2]);

  const showOutline = (layer: L.GeoJSON | L.Rectangle | null) => {
    outline.current?.remove();
    outline.current = null;
    const m = appMap.current?.map;
    if (!layer || !m) return;
    layer.setStyle(SELECTED_STYLE);
    (layer.options as L.PathOptions & { pane?: string; interactive?: boolean }).interactive = false;
    outline.current = layer;
    // A GeoJSON group needs the pane on each child path.
    if (layer instanceof L.GeoJSON) layer.eachLayer((l) => ((l as L.Path).options.pane = 'selection'));
    else layer.options.pane = 'selection';
    layer.addTo(m);
  };

  const fit = () => {
    const m = appMap.current?.map;
    if (!m || !fitNext.current) {
      fitNext.current = true; // the first area of a shared link keeps the link's view
      return;
    }
    const b = cellLayer.current?.bounds() ?? (outline.current as L.GeoJSON | null)?.getBounds?.();
    if (b?.isValid()) m.fitBounds(b, { padding: [24, 24], maxZoom: 7, animate: false });
  };

  // ---- custom area -----------------------------------------------------------------------------------
  const drawBbox = useCallback(
    async (bbox: Bbox, opts: { fit?: boolean } = {}) => {
      if (!countries) return;
      setDrawMsg(null);
      setCellPick(null);
      // Pick the grid with the most cells whose centre is inside the rectangle.
      let best: { id: string; name: string; cells: number[] } | null = null;
      let touched = 0;
      for (const gi of grids) {
        const meta = await loadGridMeta(gi.id);
        const cells: number[] = [];
        meta.cells.forEach(([iy, ix], c) => {
          const lat = (iy + 0.5) * meta.deg, lon = (ix + 0.5) * meta.deg;
          if (lon < bbox[0] || lon > bbox[2] || lat < bbox[1] || lat > bbox[3]) return;
          cells.push(c);
        });
        if (cells.length) touched++;
        if (cells.length > (best?.cells.length ?? 0)) best = { id: gi.id, name: meta.name, cells };
      }
      if (!best) {
        setDrawMsg({ kind: 'warn', text: t('draw.none') });
        return;
      }
      setGridLoading(true);
      setDrawMsg({ kind: 'info', text: t('draw.computing', { n: best.cells.length }) });
      try {
        const g = await loadGrid(best.id);
        await new Promise((r) => setTimeout(r, 0)); // let the "calibrating" message paint
        const t0 = performance.now();
        const raw = K367.buildAoiData(g, best.cells, t('area.custom', { n: best.cells.length }));
        const ms = Math.round(performance.now() - t0);
        const d = prepare(raw);
        let km2 = 0, det = 0;
        for (const c of best.cells) {
          km2 += cellKm2(g.meta.cells[c][0], g.meta.deg);
          det += g.meta.total[c];
        }
        setCustom({
          gridId: best.id,
          cells: best.cells,
          bbox,
          info: t('draw.info', { n: best.cells.length, km2: nf(km2), det: nf(det), ms }),
          warnings: raw.warnings,
        });
        setData(d);
        // Read the ref now: the updater runs later, after it has been cleared.
        const want = wantWeek.current;
        wantWeek.current = undefined;
        setWeek((w) => pickWeek(d, want ?? data?.weeks[w]));
        setGrid(g);
        const view = makeCellView(d, g, best.cells);
        setCellView(view);
        cellLayer.current?.setCells(g, best.cells);
        const [w, s, e, n] = bbox;
        showOutline(L.rectangle([[s, w], [n, e]]));
        if (opts.fit) appMap.current?.map.fitBounds([[s, w], [n, e]], { padding: [24, 24], maxZoom: 8, animate: false });
        setDrawMsg(touched > 1 ? { kind: 'info', text: t('draw.multi', { name: best.name }) } : null);
      } catch (e) {
        setDrawMsg({ kind: 'warn', text: t('err.load', { msg: (e as Error).message }) });
      } finally {
        setGridLoading(false);
      }
    },
    [countries, grids, t, nf, data],
  );

  // A shared link with a custom rectangle.
  const bootBbox = useRef(initial.bbox);
  useEffect(() => {
    if (!bootBbox.current || !countries || grids.length === 0) return;
    const b = bootBbox.current;
    bootBbox.current = undefined;
    fitNext.current = true; // the rectangle fits itself; a preset picked later fits as usual
    void drawBbox(b, { fit: !initial.view }).finally(() => setBootPending(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countries, grids]);

  // Geoman rectangle drawing.
  useEffect(() => {
    const m = appMap.current?.map;
    if (!m) return;
    const onCreate = (e: { shape: string; layer: L.Rectangle }) => {
      if (e.shape !== 'Rectangle') return;
      const bbox = boundsBbox(e.layer.getBounds());
      e.layer.remove();
      setDrawing(false);
      fitNext.current = false;
      void drawBbox(bbox);
    };
    const onEnd = () => setDrawing(false);
    m.on('pm:create', onCreate as unknown as L.LeafletEventHandlerFn);
    m.on('pm:drawend', onEnd);
    return () => {
      m.off('pm:create', onCreate as unknown as L.LeafletEventHandlerFn);
      m.off('pm:drawend', onEnd);
    };
  }, [drawBbox]);

  useEffect(() => {
    const m = appMap.current?.map;
    if (!m) return;
    if (drawing) {
      m.pm.enableDraw('Rectangle', {
        snappable: false,
        cursorMarker: false,
        pathOptions: { color: '#533afd', weight: 2, fillOpacity: 0.08 },
      } as L.PM.DrawModeOptions);
      const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawing(false);
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('keydown', onKey);
        m.pm.disableDraw();
      };
    }
  }, [drawing]);

  const backToPreset = () => {
    setCustom(null);
    setDrawMsg(null);
    fitNext.current = true;
  };

  // ---- derived values ---------------------------------------------------------------------------------
  const shown = useMemo(() => (data ? shownSeries(data, mode) : null), [data, mode]);
  const pct = useMemo(() => (data ? percentiles(data, mode) : []), [data, mode]);
  const latest = useMemo(() => (data ? latestWeek(data, mode) : null), [data, mode]);
  const jump = useMemo(() => (data ? sensorJump(data) : null), [data]);
  const calYears = useMemo(() => (!data ? [] : isMobile && !showAllYears ? data.years.slice(-3) : data.years), [data, isMobile, showAllYears]);

  // On mobile the controls drawer covers the map, so opening it pauses playback.
  useEffect(() => {
    if (isMobile && drawerOpen) setPlaying(false);
  }, [isMobile, drawerOpen]);

  // Keep the selected week visible in the compact (3-year) calendar.
  useEffect(() => {
    if (data && isMobile && !showAllYears && !calYears.includes(data.year[week])) setShowAllYears(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);

  // ---- map cells for the selected week -------------------------------------------------------------------
  // The new algorithm's data is in another unit than the grid, so its map shows the grid's raw detections.
  const cellMode: HistoryMode = ds === 'v2' ? 'raw' : mode;
  const values = useMemo(() => (data && grid && cellView ? cellValues(data, grid, cellView, week, cellMode) : null), [data, grid, cellView, week, cellMode]);
  useEffect(() => {
    if (!data || !grid || !cellView || !values) return;
    cellLayer.current?.setValues(values, cellVmax(data, grid, cellView, cellMode));
  }, [values, data, grid, cellView, cellMode]);
  useEffect(() => cellLayer.current?.select(cellPick?.k ?? null), [cellPick, cellView]);

  // ---- URL hash + shared viewport ------------------------------------------------------------------------
  const writeHash = useCallback(() => {
    const m = appMap.current?.map;
    if (!active || !m || !data) return;
    replaceHash(
      historyHash({
        area: custom ? undefined : areaId,
        dataset: ds === 'v2' ? 'v2' : undefined,
        mode,
        cal: calView,
        week: data.weeks[week],
        bbox: custom?.bbox,
        view: viewOf(m),
      }),
    );
  }, [active, data, custom, areaId, ds, mode, calView, week]);

  useEffect(writeHash, [writeHash]);

  useEffect(() => {
    const m = appMap.current?.map;
    if (!m) return;
    const onMove = () => {
      writeHash();
      setMapTick((x) => x + 1);
      if (active) onViewChange(viewOf(m));
    };
    m.on('moveend zoomend', onMove);
    return () => {
      m.off('moveend zoomend', onMove);
    };
  }, [writeHash, active, onViewChange]);

  useEffect(() => {
    const m = appMap.current?.map;
    if (!active || !m) return;
    m.invalidateSize();
    const v = sharedView();
    if (v) m.setView(v.center, v.zoom, { animate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // ---- actions ------------------------------------------------------------------------------------------
  const downloadCsv = () => {
    if (!data) return;
    const blob = new Blob([toCsv(data, mode, ds === 'v2' ? 'modis_equivalent_active_cells' : undefined)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kelvin367_${custom ? 'custom' : data.id}_${mode === 'raw' ? 'raw' : 'harm'}${ds === 'v2' ? '_v2' : ''}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const onWeek = useCallback((i: number) => setWeek(i), []);

  const areaName = (id: string) => {
    const key = `area.${id}` as MessageKey;
    const s = t(key);
    return s === key ? areas.find((a) => a.id === id)?.name ?? id : s;
  };

  // ---- render ----------------------------------------------------------------------------------------------
  const weekStart = data?.weeks[week];
  const weekText = weekStart ? weekLabel(weekStart, locale) : '';
  const yearText = weekStart?.slice(0, 4) ?? '';
  const currentName = custom ? t('area.custom', { n: custom.cells.length }) : areaName(areaId);
  // Ver. 2 has no raw series: Raw is still offered there and switches back to Ver. 1.
  const rawAvailable = !!data && (ds === 'v2' || hasRaw(data));
  const changeMode = (m: HistoryMode) => {
    if (m === 'raw' && ds === 'v2') switchDataset('v1');
    setMode(m);
  };

  const areaPicker = (className: string) => (
    <label className={className}>
      <span className="area-icon" aria-hidden="true">
        <Icon name="area" size={24} />
      </span>
      <span className="sr-only">{t('area.aria')}</span>
      <select
        value={custom ? '__custom' : areaId}
        onChange={(e) => {
          if (e.target.value === '__custom') return;
          setCustom(null);
          setDrawMsg(null);
          fitNext.current = true;
          setAreaId(e.target.value);
        }}
      >
        {custom && <option value="__custom">{currentName}</option>}
        {areas.map((a) => (
          <option key={a.id} value={a.id}>
            {areaName(a.id)} ({a.from.slice(0, 4)}–{a.to.slice(0, 4)})
          </option>
        ))}
      </select>
      <Icon name="chevron" size={16} />
    </label>
  );

  let cellCard = null;
  if (cellPick && values && grid && cellView && appMap.current) {
    const p = appMap.current.map.latLngToContainerPoint(cellPick.latlng);
    cellCard = (
      <button type="button" className="map-tooltip" style={{ left: p.x, top: p.y } as CSSProperties} onClick={() => setCellPick(null)} aria-label={t('map.cell.close')}>
        <span>{t('map.cell')}</span>
        <strong>{nf(values[cellPick.k], cellMode === 'raw' ? 0 : 1)}</strong>
      </button>
    );
  }

  return (
    <div className="tab-pane" hidden={!active}>
      <div className="map-stage">
        <div ref={mapEl} className="leaflet-host" role="application" aria-label={t('map.cell.aria')} onClick={() => drawerOpen && setDrawerOpen(false)} />
      </div>
      {cellCard}

      <div className="map-status">
        {(gridLoading || (!data && !error)) && (
          <div className="pill loading">
            <span className="spinner" />
            <span>{gridLoading ? t('map.loadingGrid') : t('common.loading')}</span>
          </div>
        )}
        {error && (
          <div className="pill banner" data-kind="error">
            {error}
          </div>
        )}
        {drawing && (
          <div className="pill banner" data-kind="info">
            {t('draw.hint')}
          </div>
        )}
      </div>

      {areaPicker('map-area-chip mobile-only')}

      <div className="legend">
        <span>{t('legend.less')}</span>
        <div className="legend-ramp">
          {[0, 0.2, 0.4, 0.6, 0.8, 1].map((x) => (
            <i key={x} style={{ background: ramp(SEQ, x) }} />
          ))}
        </div>
        <span>{t('legend.more')}</span>
      </div>

      <SidePanel
        eyebrow={t('hist.eyebrow')}
        title={t('tab.history')}
        label={t('hist.panel')}
        open={drawerOpen}
        collapsed={collapsed}
        onClose={() => setDrawerOpen(false)}
        onCollapse={() => setCollapsed(true)}
        onExpand={() => setCollapsed(false)}
      >
        <div className="area-row">
          {areaPicker('area-select')}
          <button
            type="button"
            className={`draw-button ${drawing ? 'active' : ''}`}
            aria-pressed={drawing}
            onClick={() => {
              setDrawing(!drawing);
              setDrawerOpen(false);
            }}
          >
            <Icon name="draw" size={17} /> {drawing ? t('draw.cancel') : t('draw.area')}
          </button>
        </div>
        {custom && (
          <div className="custom-info">
            <p className="hint">{custom.info}</p>
            {custom.warnings.length > 0 && <p className="hint warn">{custom.warnings.join(' ')}</p>}
            <button type="button" className="link-btn" onClick={backToPreset}>
              {t('draw.back', { area: areaName(areaId) })}
            </button>
          </div>
        )}
        {drawMsg && <p className={`hint ${drawMsg.kind === 'warn' ? 'warn' : ''}`}>{drawMsg.text}</p>}

        <section className="mode-section">
          <Segmented
            value={mode}
            onChange={changeMode}
            label={t('mode.aria')}
            options={[
              { value: 'raw', label: t('mode.raw'), disabled: !rawAvailable, title: rawAvailable ? undefined : t('mode.raw.missing') },
              { value: 'harm', label: t('mode.harm') },
            ]}
          />
          {hasV2 && mode === 'harm' && (
            <div className="ds-switch">
              <Segmented
                value={ds}
                onChange={switchDataset}
                label={t('ds.aria')}
                options={[
                  { value: 'v1', label: t('ds.v1') },
                  { value: 'v2', label: t('ds.v2') },
                ]}
              />
            </div>
          )}
          <p>{mode === 'raw' ? t('mode.raw.help') : t('mode.harm.help')}</p>
        </section>

        <section className="calendar-section" id="hist-calendar">
          <div className="section-heading">
            <div>
              <span className="eyebrow">{t('cal.eyebrow')}</span>
              <h2>{t('cal.title')}</h2>
            </div>
            <details className="info-pop">
              <summary className="icon-info" aria-label={t('cal.info')} title={t('cal.info')}>
                <Icon name="info" size={17} />
              </summary>
              <p>{t('cal.info.text')}</p>
            </details>
          </div>
          <div className="calendar-controls">
            <Segmented
              value={calView}
              onChange={setCalView}
              label={t('cal.view.aria')}
              className="compact"
              options={[
                { value: 'counts', label: t('cal.view.counts') },
                { value: 'unusual', label: t('cal.view.unusual') },
              ]}
            />
            {calView === 'unusual' && (
              <span className="cal-legend">
                {t('legend.quieter')}
                <i style={{ background: `linear-gradient(90deg, ${[0, 25, 50, 75, 100].map(divColor).join(',')})` }} />
                {t('legend.busier')}
              </span>
            )}
          </div>
          {data && shown && (
            <Calendar data={data} shown={shown} pct={pct} view={calView} mode={mode} selected={week} onSelect={onWeek} years={calYears} theme={theme} />
          )}
          {data && isMobile && data.years.length > 3 && (
            <button type="button" className="link-btn show-years" onClick={() => setShowAllYears(!showAllYears)}>
              {showAllYears ? t('cal.showRecent') : t('cal.showAll', { n: data.years.length })}
            </button>
          )}
          <button type="button" className="download-button" onClick={downloadCsv} disabled={!data}>
            <Icon name="download" /> {t('csv')}
          </button>
        </section>

        {data && (
          <div className="metrics" aria-label={t('metrics.aria')}>
            <MetricCard
              label={t('metric.latest')}
              value={latest ? nf(latest.value) : t('common.na')}
              detail={latest ? t('metric.latest.detail', { label: t(`now.label.${latest.label}` as MessageKey), p: Math.round(latest.pct) }) : t('metric.latest.none')}
              tone={latest?.tone ?? ''}
              title={latest ? `${weekLabel(latest.week, locale)} ${latest.week.slice(0, 4)}` : undefined}
            />
            {jump && (
              <MetricCard
                label={t('metric.jump')}
                value={`×${(mode === 'raw' ? jump.raw : jump.harm).toFixed(1)}`}
                detail={t('metric.jump.detail', { raw: jump.raw.toFixed(1), harm: jump.harm.toFixed(1) })}
                tone={mode === 'raw' ? 'warm' : 'good'}
                title={t('metric.jump.help')}
              />
            )}
            <MetricCard label={t('metric.weeks')} value={nf(data.weeks.length)} detail={t('metric.weeks.detail', { from: data.weeks[0], to: data.weeks[data.weeks.length - 1] })} />
          </div>
        )}

        {hasV2 && comparison && (
          <div className="compare ds-compare">
            <h3>{t('cmp.title')}</h3>
            <p className="hint">{t('cmp.help', { n: nf(comparison.weeks) })}</p>
            <div className="compare-row">
              <span>{t('cmp.rank')}</span>
              <strong>{comparison.rank == null ? '–' : nf(comparison.rank, 2)}</strong>
            </div>
            <div className="compare-row">
              <span>{t('cmp.scale')}</span>
              <strong>{comparison.scale == null ? '–' : `×${nf(comparison.scale, 2)}`}</strong>
            </div>
            <div className="compare-row">
              <span>{t('cmp.unusual')}</span>
              <strong>{t('cmp.unusual.value', { a: comparison.unusual.current, b: comparison.unusual.next, both: comparison.unusual.both })}</strong>
            </div>
            <div className="compare-row">
              <span>{t('cmp.onModis')}</span>
              <strong>
                {t('cmp.pair', {
                  a: comparison.onModis.current == null ? '–' : nf(comparison.onModis.current, 2),
                  b: comparison.onModis.next == null ? '–' : nf(comparison.onModis.next, 2),
                })}
              </strong>
            </div>
          </div>
        )}
      </SidePanel>

      {data && (
        <Scrubber
          index={week}
          max={data.weeks.length - 1}
          onChange={onWeek}
          playing={playing}
          onPlaying={setPlaying}
          label={weekText}
          sublabel={yearText}
          ariaLabel={t('scrub.aria')}
          ariaValueText={`${weekText} ${yearText}`}
          after={
            <button
              type="button"
              className="date-button"
              aria-label={t('cal.title')}
              title={t('cal.title')}
              onClick={() => {
                setCollapsed(false);
                setDrawerOpen(true);
                setTimeout(() => document.getElementById('hist-calendar')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
              }}
            >
              <Icon name="calendar" size={18} />
            </button>
          }
        />
      )}

    </div>
  );
}

/** Requested week if present, otherwise the latest week of the record. */
function pickWeek(d: Prepared, want?: string): number {
  if (want) {
    const i = d.weekIndex.get(want);
    if (i !== undefined) return i;
    // nearest week on or after the wanted date
    const j = d.weeks.findIndex((w) => w >= want);
    if (j >= 0) return j;
  }
  return d.weeks.length - 1;
}

/** Grid cells whose centre lies inside any of the features. */
function cellsInCountries(g: Grid, features: CountryFeature[]): number[] {
  const deg = g.meta.deg;
  const out: number[] = [];
  g.meta.cells.forEach(([iy, ix], c) => {
    const lat = (iy + 0.5) * deg, lon = (ix + 0.5) * deg;
    if (features.some((f) => featureContains(f, lon, lat))) out.push(c);
  });
  return out;
}
