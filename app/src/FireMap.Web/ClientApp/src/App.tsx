// Shell: top bar + two tabs. Each tab owns its Leaflet map and is mounted on first visit, then kept
// (hidden) so switching back is instant; the map viewport is handed over between tabs.
import { useCallback, useEffect, useRef, useState } from 'react';
import { TopBar } from './components/TopBar';
import { AboutSheet } from './components/AboutSheet';
import { HistoryTab } from './features/history/HistoryTab';
import { ForecastTab } from './features/forecast/ForecastTab';
import { parseHash, type MapView, type Tab } from './lib/hashState';
import { useTheme } from './lib/theme';

export default function App() {
  const [initial] = useState(() => parseHash(location.hash));
  const [tab, setTab] = useState<Tab>(initial.tab);
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set([initial.tab]));
  const [aboutOpen, setAboutOpen] = useState(false);
  const { choice, setChoice, theme } = useTheme();
  const view = useRef<MapView | null>(initial.forecast.view ?? initial.history.view ?? null);

  const openTab = useCallback((next: Tab) => {
    setTab(next);
    setVisited((v) => (v.has(next) ? v : new Set(v).add(next)));
  }, []);

  // Back/forward or a pasted link with another tab.
  useEffect(() => {
    const onHash = () => {
      const p = parseHash(location.hash);
      if (p.tab !== tab) openTab(p.tab);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [tab, openTab]);

  const sharedView = useCallback(() => view.current, []);
  const onViewChange = useCallback((v: MapView) => {
    view.current = v;
  }, []);

  return (
    <div className="app">
      <TopBar tab={tab} onTab={openTab} theme={choice} onTheme={setChoice} onAbout={() => setAboutOpen(true)} />
      <main className="map-shell">
        {visited.has('history') && (
          <HistoryTab
            active={tab === 'history'}
            theme={theme}
            initial={initial.tab === 'history' ? initial.history : {}}
            sharedView={sharedView}
            onViewChange={onViewChange}
          />
        )}
        {visited.has('forecast') && (
          <ForecastTab
            active={tab === 'forecast'}
            initial={initial.tab === 'forecast' ? initial.forecast : {}}
            sharedView={sharedView}
            onViewChange={onViewChange}
          />
        )}
      </main>
      <AboutSheet open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  );
}
