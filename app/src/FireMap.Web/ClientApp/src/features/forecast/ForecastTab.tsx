// Forecast tab: today's live NASA FIRMS map (port of the original app.js), in the Figma layout, plus the
// team's daily forecast for Spain (./outlook.ts, ./OutlookLayer.ts): a "Forecast" entry in Layers
// adds the forecast's future days to the timeline, and its cells show on the map on those days.
//
// Rules carried over from the original app:
//  - Date inputs only validate while you edit; nothing loads until Apply/Enter (two-ended edits stay possible).
//  - Only one area filter at a time; pressing a tool button again removes its filter.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import L from 'leaflet';
import { api, type AppConfig, type LayerDef, type ServerStatus, type StatsResult } from '../../lib/api';
import { addDays, dayDiff, enumerateDays, rangeLabel, shiftYears, shortDate } from '../../lib/dates';
import { loadCountries, type Bbox } from '../../lib/geo';
import { forecastHash, replaceHash, type ForecastHash, type MapView, type Range } from '../../lib/hashState';
import { cssVar } from '../../lib/theme';
import { createMap, viewOf, type AppMap } from '../../map/createMap';
import { useI18n } from '../../i18n';
import { Icon } from '../../components/Icon';
import { SidePanel } from '../../components/SidePanel';
import { AreaSelector, type SelectMode } from './AreaSelector';
import { HotspotLayers, type Days, type LayerStatus, type Period, type Selection } from './HotspotLayers';
import { StatsView } from './StatsView';
import { TimelineBar, type TimelinePeriod } from './TimelineBar';
import { isExperimentalDay, loadOutlook, OUTLOOK_BREAKS, percent, type OutlookFile } from './outlook';
import { OutlookLayer, outlookColor } from './OutlookLayer';

const DEFAULT_VIEW: MapView = { center: [48.1, 28.3], zoom: 5 };
const QUICK_DAYS = [1, 2, 7, 30];
const COMPARE_YEARS = [1, 2, 5];

interface Applied {
  from: string;
  to: string;
  compare: Range | null;
}

interface Draft {
  from: string;
  to: string;
  cmpFrom: string;
  cmpTo: string;
}

type StatsState =
  | { state: 'idle' }
  | { state: 'loading'; label: string }
  | { state: 'error'; message: string }
  | { state: 'ok'; results: StatsResult[]; periods: Period[] };

interface Boot {
  config: AppConfig;
  defs: LayerDef[];
  countries: { iso3: string; name: string }[];
}

export function ForecastTab({
  active,
  initial,
  sharedView,
  onViewChange,
  drawerOpen,
  setDrawerOpen,
}: {
  active: boolean;
  initial: ForecastHash;
  sharedView: () => MapView | null;
  onViewChange: (v: MapView) => void;
  /** Mobile drawer state; owned by App so the top bar's Explore button can open it. */
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
}) {
  const { t, nf, locale } = useI18n();
  const mapEl = useRef<HTMLDivElement>(null);
  const appMap = useRef<AppMap | null>(null);
  const hotspots = useRef<HotspotLayers | null>(null);
  const selector = useRef<AreaSelector | null>(null);
  const outlookLayer = useRef<OutlookLayer | null>(null);
  const outlookPopup = useRef<L.Popup | null>(null);
  const lastOtherPopup = useRef(0);

  const [boot, setBoot] = useState<Boot | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [draft, setDraft] = useState<Draft>({ from: '', to: '', cmpFrom: '', cmpTo: '' });
  const [compareOpen, setCompareOpen] = useState(false);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Selection | null>(null);
  const [selMode, setSelMode] = useState<SelectMode>(null);
  const [statuses, setStatuses] = useState<Record<string, LayerStatus>>({});
  const [comparing, setComparing] = useState(false);
  const [loadingNames, setLoadingNames] = useState<string[]>([]);
  const [dayCounts, setDayCounts] = useState<Partial<Record<Period['key'], Map<string, number>>>>({});
  const [timelineOn, setTimelineOn] = useState(false);
  const [dayIndex, setDayIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1000);
  // The drawer opens only from the mobile Explore button and covers the map: pause playback.
  useEffect(() => {
    if (drawerOpen) setPlaying(false);
  }, [drawerOpen]);
  const [stats, setStats] = useState<StatsState>({ state: 'idle' });
  const [server, setServer] = useState<ServerStatus | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [outlook, setOutlook] = useState<OutlookFile | null>(null);
  const [outlookOn, setOutlookOn] = useState(!initial.outlookOff);
  const [outlookCell, setOutlookCell] = useState<number | null>(null);
  // Set when the forecast should start playing: the outlook loaded, the tab was opened, or the layer was switched on.
  const playForecast = useRef(false);

  // ---- boot: config + layers + countries, then the map and its imperative helpers ----------------
  useEffect(() => {
    let cancelled = false;
    Promise.all([api.config(), api.layers(), loadCountries()])
      .then(([config, defs, countries]) => {
        if (cancelled || !mapEl.current) return;
        const view = initial.view ?? sharedView() ?? DEFAULT_VIEW;
        const m = createMap(mapEl.current, view);
        appMap.current = m;

        const maxDate = maxDateOf(config, defs);
        let to = initial.to ?? config.today;
        let from = initial.from ?? addDays(to, -1);
        // In sample mode the data covers fixed dates; start where there is something to see.
        if (config.mode === 'sample' && !initial.from) {
          to = maxDate;
          from = addDays(maxDate, -4);
        }
        const en = new Set(initial.layers?.filter((id) => defs.some((d) => d.id === id)) ?? defs.filter((d) => d.defaultVisible).map((d) => d.id));
        const limits = { min: minDateOf(defs, en), max: maxDate, maxDays: config.maxRangeDays };
        // A shared link may carry out-of-range periods: fall back to defaults.
        if (validateRange(from, to, limits)) {
          to = maxDate;
          from = addDays(to, -1);
        }
        const compare = initial.compare && !validateRange(initial.compare.from, initial.compare.to, limits) ? initial.compare : null;

        const hs = new HotspotLayers(m.map, {
          onStatus: (id, s, cmp) => {
            setStatuses((prev) => ({ ...prev, [id]: s }));
            setComparing(cmp);
          },
          onLoadingChange: (names) => setLoadingNames((prev) => (prev.join() === names.join() ? prev : names)),
          onData: () => setDayCounts(hs.dayCounts()),
        });
        hs.init(config, defs, en);
        hotspots.current = hs;

        const sel = new AreaSelector(m.map, {
          onSelect: (s) => {
            setSelection(s);
            hs.setFilter(s); // map shows only points inside the selection
          },
          onClear: () => {
            setSelection(null);
            hs.setFilter(null); // back to everything in the current view
          },
          onModeChange: (mode) => setSelMode(mode),
        });
        sel.setCountries(countries);
        selector.current = sel;

        setEnabled(en);
        setApplied({ from, to, compare });
        setDraft({ from, to, cmpFrom: compare?.from ?? '', cmpTo: compare?.to ?? '' });
        setCompareOpen(!!compare);
        setBoot({ config, defs, countries: sel.countryList() });

        if (initial.country) sel.selectCountry(initial.country, { fit: !initial.view });
        else if (initial.bbox) sel.selectBbox(initial.bbox, { fit: !initial.view });

        // The outlook is optional: if its file is missing the rest of the tab works as before.
        loadOutlook()
          .then((data) => {
            if (cancelled || appMap.current !== m) return;
            outlookLayer.current = new OutlookLayer(m.map, data);
            playForecast.current = !initial.outlookOff;
            setOutlook(data);
          })
          .catch(() => undefined);
      })
      .catch((err: Error) => !cancelled && setBootError(err.message));
    return () => {
      cancelled = true;
      selector.current?.destroy();
      outlookLayer.current?.destroy();
      outlookLayer.current = null;
      hotspots.current?.destroy();
      appMap.current?.destroy();
      appMap.current = null;
    };
    // Boot once per mount; `initial` is the hash at first visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (hotspots.current) hotspots.current.t = t;
  }, [t, boot]);

  useEffect(() => {
    if (hotspots.current) hotspots.current.popupsEnabled = selMode === null;
  }, [selMode]);

  // ---- derived ---------------------------------------------------------------------------------
  const maxDate = boot ? maxDateOf(boot.config, boot.defs) : '';
  const limits = useMemo(
    () => (boot ? { min: minDateOf(boot.defs, enabled), max: maxDateOf(boot.config, boot.defs), maxDays: boot.config.maxRangeDays } : null),
    [boot, enabled],
  );

  const periods = useMemo<Period[]>(() => {
    if (!applied) return [];
    const a: Period = { key: 'A', from: applied.from, to: applied.to, color: cssVar('--period-a'), label: rangeLabel(applied.from, applied.to, locale) };
    if (!applied.compare) return [a];
    const { from, to } = applied.compare;
    return [a, { key: 'B', from, to, color: cssVar('--period-b'), label: rangeLabel(from, to, locale) }];
  }, [applied, locale]);

  // With the Forecast layer on, the timeline continues past the observed range into the forecast's future days
  // (single period only, and only when the range reaches the day before the forecast starts).
  const forecastExtra = useMemo(() => {
    if (!outlook || !outlookOn || !applied || applied.compare || !outlook.days.length) return [];
    if (applied.to < addDays(outlook.days[0], -1)) return [];
    return outlook.days.filter((day) => day > applied.to);
  }, [outlook, outlookOn, applied]);

  const timelinePeriods = useMemo<TimelinePeriod[]>(
    () => periods.map((p, i) => ({ ...p, days: [...enumerateDays(p.from, p.to), ...(i === 0 ? forecastExtra : [])] })),
    [periods, forecastExtra],
  );
  const forecastDays = useMemo(() => new Set(outlook && outlookOn ? outlook.days : []), [outlook, outlookOn]);
  const experimentalDays = useMemo(
    () => new Set(outlook && outlookOn ? outlook.days.filter((_, i) => isExperimentalDay(outlook, i)) : []),
    [outlook, outlookOn],
  );

  // The forecast shows on the map only while the timeline is on one of its days.
  const timelineDay = timelineOn ? timelinePeriods[0]?.days[dayIndex] : undefined;
  const forecastIdx = outlook && outlookOn && timelineDay ? outlook.days.indexOf(timelineDay) : -1;

  const days: Days = useMemo(
    () => (timelineOn ? Object.fromEntries(timelinePeriods.map((p) => [p.key, p.days[dayIndex] ?? null])) : null),
    [timelineOn, timelinePeriods, dayIndex],
  );

  // ---- push state into the map ------------------------------------------------------------------
  useEffect(() => {
    if (!hotspots.current || periods.length === 0) return;
    hotspots.current.setPeriods(periods);
    setDayIndex(0); // new period(s): restart from the first day
  }, [periods]);

  useEffect(() => {
    hotspots.current?.setDays(days);
  }, [days]);

  // Opening the tab again replays the forecast (declared first so the effect below sees the flag).
  useEffect(() => {
    if (active && outlookOn) playForecast.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Keep the timeline position valid when forecast days are removed. When the forecast is shown (outlook loaded,
  // tab opened, layer switched on), start playback at the forecast's first day so the cells change on the map.
  useEffect(() => {
    const len = Math.max(0, ...timelinePeriods.map((p) => p.days.length));
    if (dayIndex > len - 1) setDayIndex(Math.max(0, len - 1));
    if (!active) {
      setPlaying(false); // nothing to watch while the other tab is open
      return;
    }
    if (playForecast.current && outlook) {
      playForecast.current = false;
      const i = timelinePeriods[0]?.days.indexOf(outlook.days[0]) ?? -1;
      if (i >= 0) {
        setTimelineOn(true);
        setDayIndex(i);
        setPlaying(!drawerOpen);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelinePeriods, active]);

  // ---- statistics for the selected area ----------------------------------------------------------
  useEffect(() => {
    if (!selection || !boot || periods.length === 0) {
      setStats({ state: 'idle' });
      return;
    }
    const layers = [...enabled];
    if (layers.length === 0) {
      setStats({ state: 'error', message: t('stats.needLayer') });
      return;
    }
    const controller = new AbortController();
    setStats({ state: 'loading', label: selection.type === 'country' ? selection.name : t('stats.rect') });
    const area = selection.type === 'country' ? { country: selection.iso3 } : { bbox: selection.bbox };
    Promise.all(periods.map((p) => api.stats({ layers, from: p.from, to: p.to, ...area }, controller.signal)))
      .then((results) => !controller.signal.aborted && setStats({ state: 'ok', results, periods }))
      .catch((err: Error) => err.name !== 'AbortError' && setStats({ state: 'error', message: err.message }));
    return () => controller.abort();
    // `t` only changes with the language; refetching for that is not needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, periods, enabled, boot]);

  // ---- server quota (poll while visible) ----------------------------------------------------------
  useEffect(() => {
    if (!active) return;
    const poll = () => api.status().then(setServer).catch(() => undefined);
    poll();
    const id = window.setInterval(poll, 30_000);
    return () => window.clearInterval(id);
  }, [active]);

  // ---- model forecast -------------------------------------------------------------------------------
  useEffect(() => {
    const ol = outlookLayer.current;
    if (!ol || !outlook) return;
    ol.setVisible(forecastIdx >= 0);
    if (forecastIdx >= 0) ol.setDay(forecastIdx);
    else setOutlookCell(null);
  }, [outlook, forecastIdx]);
  const forecastShown = forecastIdx >= 0;

  // A map click inside the model grid shows that cell's probabilities; a second click on it closes them.
  // Clicks that open a hotspot popup (same click, fired first) or happen while an area tool is active are left alone.
  useEffect(() => {
    const m = appMap.current?.map;
    const ol = outlookLayer.current;
    if (!m || !ol || !forecastShown) return;
    const onPopup = (e: L.PopupEvent) => {
      if (e.popup !== outlookPopup.current) lastOtherPopup.current = performance.now();
    };
    const onClick = (e: L.LeafletMouseEvent) => {
      if (selMode || performance.now() - lastOtherPopup.current < 150) return;
      const k = ol.cellAt(e.latlng);
      setOutlookCell((prev) => (k == null || prev === k ? null : k));
    };
    m.on('popupopen', onPopup);
    m.on('click', onClick);
    return () => {
      m.off('popupopen', onPopup);
      m.off('click', onClick);
    };
  }, [outlook, forecastShown, selMode]);

  useEffect(() => {
    const m = appMap.current?.map;
    const ol = outlookLayer.current;
    const old = outlookPopup.current;
    outlookPopup.current = null; // before remove(): its 'remove' handler must not clear the new pick
    old?.remove();
    ol?.select(outlookCell);
    if (!m || !ol || !outlook || outlookCell == null) return;
    const c = outlook.cells[outlookCell];
    const el = document.createElement('div');
    const head = el.appendChild(document.createElement('div'));
    head.className = 'popup-head';
    head.textContent = t('outlook.cell', { lat: c.lat_center.toFixed(3), lon: c.lon_center.toFixed(3) });
    const dl = el.appendChild(document.createElement('dl'));
    dl.className = 'popup-grid';
    let experimental = false;
    outlook.days.forEach((day, i) => {
      const dt = dl.appendChild(document.createElement('dt'));
      const exp = isExperimentalDay(outlook, i);
      experimental ||= exp;
      dt.textContent = dayChip(day, locale) + (exp ? ' *' : '');
      const dd = dl.appendChild(document.createElement('dd'));
      dd.textContent = percent(outlook.series.noaa20_detection_probability[i]?.[outlookCell], nf);
      if (i === forecastIdx) dd.className = 'strong';
    });
    // The two caveats the team's file states: unvalidated area and days past the trained horizon.
    const notes = [c.outside_training_grid ? t('outlook.outside') : null, experimental ? t('outlook.experimental') : null];
    for (const text of notes) {
      if (!text) continue;
      const p = el.appendChild(document.createElement('p'));
      p.className = 'popup-note';
      p.textContent = text;
    }
    const popup = L.popup({ maxWidth: 260, className: 'hs-popup' }).setLatLng([c.lat_center, c.lon_center]).setContent(el);
    popup.on('remove', () => outlookPopup.current === popup && setOutlookCell(null));
    outlookPopup.current = popup;
    popup.openOn(m);
  }, [outlookCell, outlook, forecastIdx, locale, t, nf]);

  const toggleForecast = (on: boolean) => {
    setOutlookOn(on);
    playForecast.current = on;
  };

  const showOutlookArea = () => {
    const b = outlookLayer.current?.bounds();
    if (b) appMap.current?.map.fitBounds(b, { padding: [24, 24], animate: false });
  };

  // ---- URL hash + shared viewport -----------------------------------------------------------------
  const writeHash = useCallback(() => {
    const m = appMap.current?.map;
    if (!active || !m || !applied) return;
    replaceHash(
      forecastHash({
        from: applied.from,
        to: applied.to,
        compare: applied.compare,
        layers: [...enabled],
        view: viewOf(m),
        country: selection?.type === 'country' ? selection.iso3 : undefined,
        bbox: selection?.type === 'bbox' ? selection.bbox : undefined,
        outlookOff: !!outlook && !outlookOn,
      }),
    );
  }, [active, applied, enabled, selection, outlook, outlookOn]);

  useEffect(writeHash, [writeHash]);

  useEffect(() => {
    const m = appMap.current?.map;
    if (!m) return;
    const onMove = () => {
      writeHash();
      if (active) onViewChange(viewOf(m));
    };
    m.on('moveend', onMove);
    return () => {
      m.off('moveend', onMove);
    };
  }, [writeHash, active, onViewChange, boot]);

  // Tab became visible: the map container changed size, and the other tab may have moved the view.
  useEffect(() => {
    const m = appMap.current?.map;
    if (!active || !m) return;
    m.invalidateSize();
    const v = sharedView();
    if (v) m.setView(v.center, v.zoom, { animate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // ---- date editing -----------------------------------------------------------------------------
  const readDraft = (): Applied => ({
    from: draft.from,
    to: draft.to,
    compare: compareOpen ? { from: draft.cmpFrom, to: draft.cmpTo } : null,
  });

  const validateDraft = (d: Applied): string | null => {
    if (!limits) return null;
    const a = validateRange(d.from, d.to, limits);
    if (a) return d.compare ? t('err.period', { k: 'A', msg: tr(a) }) : tr(a);
    if (d.compare) {
      const b = validateRange(d.compare.from, d.compare.to, limits);
      if (b) return t('err.period', { k: 'B', msg: tr(b) });
    }
    return null;
  };

  const tr = (e: RangeError): string => t(e.key, e.params);

  const draftSummary = (d: Applied): string => {
    if (!boot) return '';
    const n = (r: Range) => dayDiff(r.from, r.to) + 1;
    const tx = (k: number) => k * boot.config.transactionsPerDay;
    if (!d.compare) return t('draft.one', { days: n(d), tx: tx(n(d)) });
    const a = n(d), b = n(d.compare);
    return t('draft.two', { a, b, tx: tx(a + b) }) + (a !== b ? t('draft.align') : '');
  };

  const d = readDraft();
  const aDirty = !!applied && (d.from !== applied.from || d.to !== applied.to);
  const bDirty = !!applied && !sameRange(d.compare, applied.compare);
  const dirty = aDirty || bDirty;
  const draftError = validateDraft(d);
  const hint = draftError ?? (dirty ? t('draft.press', { text: draftSummary(d) }) : draftSummary(d));

  const applyDraft = () => {
    const dd = readDraft();
    if (validateDraft(dd)) return; // keep the inputs, the hint shows why
    setApplied({ from: dd.from, to: dd.to, compare: dd.compare ? { ...dd.compare } : null });
  };

  const cancelDraft = () => {
    if (!applied) return;
    setCompareOpen(!!applied.compare);
    setDraft({ from: applied.from, to: applied.to, cmpFrom: applied.compare?.from ?? '', cmpTo: applied.compare?.to ?? '' });
  };

  /** Whole years between the period A and period B inputs (keeps "−2 years" when A changes). */
  const yearOffset = () => {
    if (!draft.from || !draft.cmpFrom) return 1;
    return Math.max(1, Number(draft.from.slice(0, 4)) - Number(draft.cmpFrom.slice(0, 4)));
  };

  const quickRange = (n: number) => {
    const to = maxDate;
    const from = addDays(to, -(n - 1));
    let compare: Range | null = null;
    if (compareOpen) {
      const back = yearOffset() || 1;
      compare = { from: shiftYears(from, -back), to: shiftYears(to, -back) };
    }
    setDraft({ from, to, cmpFrom: compare?.from ?? draft.cmpFrom, cmpTo: compare?.to ?? draft.cmpTo });
    if (limits && !validateRange(from, to, limits) && (!compare || !validateRange(compare.from, compare.to, limits))) setApplied({ from, to, compare });
  };

  const toggleCompare = () => {
    if (compareOpen) {
      setCompareOpen(false);
      if (applied?.compare) setApplied({ ...applied, compare: null });
      return;
    }
    setCompareOpen(true);
    const from = draft.from || applied?.from || '', to = draft.to || applied?.to || '';
    if (from && to) setDraft({ ...draft, cmpFrom: shiftYears(from, -1), cmpTo: shiftYears(to, -1) });
  };

  const comparePreset = (years: number) => {
    if (!draft.from || !draft.to) return;
    setDraft({ ...draft, cmpFrom: shiftYears(draft.from, -years), cmpTo: shiftYears(draft.to, -years) });
  };

  const onDateKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') applyDraft();
    if (e.key === 'Escape') cancelDraft();
  };

  // ---- layers -------------------------------------------------------------------------------------
  const toggleLayer = (id: string, on: boolean) => {
    const next = new Set(enabled);
    if (on) next.add(id);
    else next.delete(id);
    setEnabled(next);
    hotspots.current?.setEnabled(id, on);
  };

  const banner = useMemo(() => {
    const list = Object.entries(statuses).filter(([id]) => enabled.has(id)).map(([, s]) => s);
    const error = list.find((s) => s.state === 'error');
    const zoom = list.find((s) => s.state === 'zoom');
    const truncated = list.find((s) => s.state === 'ok' && s.truncated);
    const partial = list.some((s) => s.state === 'ok' && s.partial);
    if (error && error.state === 'error') return { kind: 'error', text: t('banner.error', { msg: error.message }) };
    if (zoom && zoom.state === 'zoom')
      return { kind: 'info', text: zoom.tiles ? t('banner.zoom', { tiles: zoom.tiles, max: zoom.maxTiles ?? 0 }) : zoom.message ?? '' };
    if (truncated && truncated.state === 'ok')
      return { kind: 'info', text: t('banner.truncated', { count: nf(truncated.count ?? 0), total: nf(truncated.total) }) };
    if (partial) return { kind: 'warn', text: t('banner.partial') };
    return null;
  }, [statuses, enabled, t, nf]);

  // ---- area selection ----------------------------------------------------------------------------
  // There are no area tools in the panel any more; a shared link with c:ISO3 or r:w,s,e,n still selects an area
  // (AreaSelector) and shows its statistics.

  const layerNames = useMemo(() => Object.fromEntries((boot?.defs ?? []).map((x) => [x.id, x.name])), [boot]);
  const groups = useMemo(() => {
    const m = new Map<string, LayerDef[]>();
    for (const x of boot?.defs ?? []) {
      const list = m.get(x.group) ?? [];
      list.push(x);
      m.set(x.group, list);
    }
    return [...m];
  }, [boot]);

  const quota = server
    ? server.mode === 'sample'
      ? t('quota.sample')
      : t('quota', { used: nf(server.quota.transactionsUsed), limit: nf(server.quota.limit) })
    : '';
  const quotaTitle = server
    ? t('quota.title', { hits: server.cache.hits, calls: server.cache.upstreamCalls, files: server.disk.files, mb: server.disk.sizeMb })
    : '';

  // ---- render -------------------------------------------------------------------------------------
  return (
    <div className="tab-pane" hidden={!active}>
      <div className="map-stage">
        <div ref={mapEl} className="leaflet-host" role="application" aria-label={t('tab.forecast')} onClick={() => drawerOpen && setDrawerOpen(false)} />
      </div>

      <div className="map-status">
        {bootError && <div className="pill banner" data-kind="error">{t('banner.start', { msg: bootError })}</div>}
        {loadingNames.length > 0 && (
          <div className="pill loading">
            <span className="spinner" />
            <span>{t('loading.layers', { names: loadingNames.join(', ') })}</span>
          </div>
        )}
        {banner && (
          <div className="pill banner" data-kind={banner.kind}>
            {banner.text}
          </div>
        )}
      </div>

      {forecastShown && (
        <div className="legend outlook-legend" aria-label={t('outlook.legend')}>
          <button type="button" className="link-btn" onClick={showOutlookArea} title={t('outlook.zoom')}>
            {t('outlook.layer')} · {t('outlook.area')}
          </button>
          <span className="outlook-swatch faint" />
          <span>{'<1%'}</span>
          {OUTLOOK_BREAKS.map((b, i) => (
            <span key={b} className="outlook-legend-item">
              <span className="outlook-swatch" style={{ background: outlookColor(i + 1) }} />
              <span>{i + 1 < OUTLOOK_BREAKS.length ? `${nf(b * 100)}–${nf(OUTLOOK_BREAKS[i + 1] * 100)}%` : `≥${nf(b * 100)}%`}</span>
            </span>
          ))}
          {forecastIdx >= 0 && outlook && isExperimentalDay(outlook, forecastIdx) && <span className="outlook-exp">{t('outlook.expDay')}</span>}
        </div>
      )}

      <SidePanel
        eyebrow={t('fc.eyebrow')}
        title={t('tab.forecast')}
        label={t('fc.panel')}
        open={drawerOpen}
        collapsed={collapsed}
        onClose={() => setDrawerOpen(false)}
        onCollapse={() => setCollapsed(true)}
        onExpand={() => setCollapsed(false)}
      >
        {boot && applied && (
          <>
            <section className="panel-section">
              <h2 className="section-title">
                {t('range.title')} <span className="muted">{t('range.utc')}</span>
              </h2>
              <div className="chips" role="group" aria-label={t('range.presets')}>
                {QUICK_DAYS.map((n) => (
                  <button
                    type="button"
                    key={n}
                    className={`chip ${applied.to === maxDate && dayDiff(applied.from, applied.to) + 1 === n ? 'active' : ''}`}
                    onClick={() => quickRange(n)}
                  >
                    {n === 1 ? t('range.today') : t('range.days', { n })}
                  </button>
                ))}
              </div>
              {compareOpen && (
                <div className="period-label">
                  <span className="dot" style={{ '--c': 'var(--period-a)' } as CSSProperties} />
                  {t('period.a')}
                </div>
              )}
              <div className={`date-row ${aDirty ? 'dirty' : ''}`}>
                <label>
                  {t('date.from')}
                  <input type="date" required value={draft.from} min={limits?.min} max={maxDate} onChange={(e) => setDraft({ ...draft, from: e.target.value })} onKeyDown={onDateKey} />
                </label>
                <label>
                  {t('date.to')}
                  <input type="date" required value={draft.to} min={limits?.min} max={maxDate} onChange={(e) => setDraft({ ...draft, to: e.target.value })} onKeyDown={onDateKey} />
                </label>
              </div>

              {compareOpen && (
                <div className="period-b">
                  <div className="period-label">
                    <span className="dot" style={{ '--c': 'var(--period-b)' } as CSSProperties} />
                    {t('period.b')} <span className="muted small">{t('period.compareWith')}</span>
                  </div>
                  <div className="chips" role="group" aria-label={t('period.yearsBack')}>
                    {COMPARE_YEARS.map((y) => (
                      <button type="button" key={y} className="chip" onClick={() => comparePreset(y)}>
                        {y === 1 ? t('years.back.1') : t('years.back.n', { n: y })}
                      </button>
                    ))}
                  </div>
                  <div className={`date-row ${bDirty ? 'dirty' : ''}`}>
                    <label>
                      {t('date.from')}
                      <input type="date" value={draft.cmpFrom} min={limits?.min} max={maxDate} onChange={(e) => setDraft({ ...draft, cmpFrom: e.target.value })} onKeyDown={onDateKey} />
                    </label>
                    <label>
                      {t('date.to')}
                      <input type="date" value={draft.cmpTo} min={limits?.min} max={maxDate} onChange={(e) => setDraft({ ...draft, cmpTo: e.target.value })} onKeyDown={onDateKey} />
                    </label>
                  </div>
                </div>
              )}

              <div className="range-footer">
                <p className={`hint ${draftError ? 'error' : ''}`} aria-live="polite">
                  {hint}
                </p>
                <div className="range-actions">
                  {dirty && (
                    <button type="button" className="link-btn" onClick={cancelDraft}>
                      {t('range.cancel')}
                    </button>
                  )}
                  <button type="button" className="btn-primary" disabled={!dirty || !!draftError} onClick={applyDraft}>
                    {t('range.apply')}
                  </button>
                </div>
              </div>
              <div className="range-extras">
                <button type="button" className="tool" aria-pressed={compareOpen} onClick={toggleCompare}>
                  <Icon name="compare" size={18} /> {t('range.compare')}
                </button>
              </div>
            </section>

            <section className="panel-section">
              <h2 className="section-title">{t('layers.title')}</h2>
              <ul className="layer-list">
                {groups.map(([group, items]) => (
                  <li key={group}>
                    <div className="layer-group">{group}</div>
                    <ul>
                      {items.map((def) => (
                        <li className="layer-item" key={def.id}>
                          <label title={`${def.description}\n${def.minDate ? t('layer.coverage', { min: def.minDate, max: def.maxDate ?? '' }) : t('layer.coverageUnknown')}`}>
                            <input type="checkbox" checked={enabled.has(def.id)} onChange={(e) => toggleLayer(def.id, e.target.checked)} />
                            <span className="swatch" style={{ '--c': def.color } as CSSProperties} />
                            <span className="layer-name">{def.name}</span>
                            <span className="layer-meta">{def.resolutionM ? `${def.resolutionM} m` : ''}</span>
                            <LayerBadge status={statuses[def.id]} comparing={comparing} />
                          </label>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
                {outlook && (
                  <li>
                    <div className="layer-group">{t('outlook.group')}</div>
                    <ul>
                      <li className="layer-item">
                        <label title={t('outlook.note', { issued: utcStamp(outlook.data_policy.issue_utc, locale), gfs: utcStamp(outlook.data_policy.gfs_run_utc, locale) })}>
                          <input type="checkbox" checked={outlookOn} onChange={(e) => toggleForecast(e.target.checked)} />
                          <span className="swatch" style={{ '--c': outlookColor(4) } as CSSProperties} />
                          <span className="layer-name">{t('outlook.layer')}</span>
                          <span className="layer-meta">
                            {shortDate(outlook.days[0], locale)} – {shortDate(outlook.days[outlook.days.length - 1], locale)}
                          </span>
                          <span />
                        </label>
                      </li>
                    </ul>
                  </li>
                )}
              </ul>
            </section>


            {selection && (
              <section className="panel-section stats-panel">
                <div className="stats-title">
                  <h2 className="section-title">{t('stats.title')}</h2>
                  <button type="button" className="link-btn" onClick={() => selector.current?.clear()}>
                    {t('stats.clear')}
                  </button>
                </div>
                <div aria-live="polite">
                  {stats.state === 'loading' && (
                    <div className="stats-loading">
                      <span className="spinner" /> {t('stats.loading', { label: stats.label })}
                    </div>
                  )}
                  {stats.state === 'error' && <div className="stats-error">{stats.message}</div>}
                  {stats.state === 'ok' && <StatsView results={stats.results} periods={stats.periods} layerNames={layerNames} days={days} />}
                </div>
              </section>
            )}

            <footer className="panel-footer">
              <span className={`quota ${server && server.quota.transactionsUsed >= server.quota.softLimit * 0.8 ? 'warn' : ''}`} title={quotaTitle}>
                {quota}
              </span>
              {boot.config.mode === 'sample' && <span className="badge">{t('badge.sample')}</span>}
            </footer>
          </>
        )}
      </SidePanel>

      {timelinePeriods.length > 0 && (
        <TimelineBar
          periods={timelinePeriods}
          counts={dayCounts}
          forecastDays={forecastDays}
          experimentalDays={experimentalDays}
          observedTo={applied?.to}
          on={timelineOn}
          index={dayIndex}
          playing={playing}
          speed={speed}
          onIndex={(i) => {
            setTimelineOn(true);
            setDayIndex(i);
          }}
          onPlaying={(p) => {
            if (p) setTimelineOn(true);
            setPlaying(p);
          }}
          onSpeed={setSpeed}
          onClose={() => {
            setPlaying(false);
            setTimelineOn(false);
          }}
        />
      )}

    </div>
  );
}

function LayerBadge({ status, comparing }: { status?: LayerStatus; comparing: boolean }) {
  const { t, nf } = useI18n();
  if (!status) return <span className="layer-status" data-state="idle" />;
  switch (status.state) {
    case 'loading':
      return (
        <span className="layer-status" data-state="loading">
          <span className="spinner small" />
        </span>
      );
    case 'ok': {
      const parts = status.parts ?? [];
      if (comparing) {
        const title = parts
          .map((p) => (status.day ? t('layer.periodLineDay', { k: p.key, n: nf(p.shown) }) : t('layer.periodLine', { k: p.key, n: nf(p.total) })))
          .join('\n');
        return (
          <span className="layer-status" data-state="ok" title={title}>
            {parts.map((p, i) => (
              <span key={p.key}>
                {i > 0 && <span className="muted"> · </span>}
                <span style={{ color: p.color }}>{nf(status.day ? p.shown : p.total)}</span>
              </span>
            ))}
          </span>
        );
      }
      const p = parts[0];
      if (!p) return <span className="layer-status" data-state="ok" />;
      if (status.day)
        return (
          <span className="layer-status" data-state="ok" title={t('layer.onDay', { shown: nf(p.shown), total: nf(p.total) })}>
            {nf(p.shown)}
          </span>
        );
      const title = status.truncated ? t('layer.truncated', { count: nf(status.count ?? 0), total: nf(status.total) }) : status.partial ? t('layer.partial') : '';
      return (
        <span className="layer-status" data-state="ok" title={title}>
          {nf(p.total)}
          {status.partial || status.truncated ? '*' : ''}
        </span>
      );
    }
    case 'zoom':
      return (
        <span className="layer-status" data-state="zoom">
          {t('layer.zoom')}
        </span>
      );
    case 'error':
      return (
        <span className="layer-status" data-state="error" title={status.message}>
          {t('layer.error')}
        </span>
      );
    default:
      return <span className="layer-status" data-state="idle" />;
  }
}

// ---- pure helpers --------------------------------------------------------------------------------

interface Limits {
  min: string;
  max: string;
  maxDays: number;
}

interface RangeError {
  key: 'err.bothDates' | 'err.startAfterEnd' | 'err.dataStarts' | 'err.endAfter' | 'err.tooLong';
  params?: Record<string, string | number>;
}

/** Returns an error, or null when [from, to] is a valid range. */
export function validateRange(from: string, to: string, l: Limits): RangeError | null {
  if (!from || !to) return { key: 'err.bothDates' };
  if (from > to) return { key: 'err.startAfterEnd' };
  if (l.min && from < l.min) return { key: 'err.dataStarts', params: { min: l.min } };
  if (to > l.max) return { key: 'err.endAfter', params: { max: l.max } };
  const days = dayDiff(from, to) + 1;
  if (days > l.maxDays) return { key: 'err.tooLong', params: { days, max: l.maxDays } };
  return null;
}

const sameRange = (x: Range | null | undefined, y: Range | null | undefined) =>
  (x?.from ?? null) === (y?.from ?? null) && (x?.to ?? null) === (y?.to ?? null);

function maxDateOf(config: AppConfig, defs: LayerDef[]): string {
  if (config.mode === 'sample') return defs.map((d) => d.maxDate).filter((x): x is string => !!x).sort().at(-1) ?? config.today;
  return config.today;
}

function minDateOf(defs: LayerDef[], enabled: Set<string>): string {
  return defs.filter((d) => enabled.has(d.id) && d.minDate).map((d) => d.minDate as string).sort()[0] ?? '2000-11-01';
}

export type { Bbox };

/** "Sun 15 Nov" for an outlook day (UTC). */
function dayChip(iso: string, locale: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString(locale, { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
}

/** "15 Nov, 00:00 UTC" for an ISO timestamp. */
function utcStamp(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleString(locale, { timeZone: 'UTC', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })} UTC`;
}
