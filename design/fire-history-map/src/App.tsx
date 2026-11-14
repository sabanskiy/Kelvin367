import { useEffect, useMemo, useState } from "react";

type Theme = "light" | "dark" | "system";
type DataMode = "raw" | "harmonized";
const ramp = ["#FFF7E6", "#FDE0A0", "#F8AA5A", "#E26428", "#A82818", "#4A0E0E"];

function Icon({
  name,
  size = 18,
}: {
  name:
    | "chevron"
    | "draw"
    | "download"
    | "play"
    | "pause"
    | "info"
    | "calendar"
    | "close"
    | "controls"
    | "collapse";
  size?: number;
}) {
  const paths = {
    chevron: <path d="m6 9 6 6 6-6" />,
    draw: (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
        <path d="M4 19v2h16v-2" />
      </>
    ),
    play: <path d="m9 6 9 6-9 6Z" />,
    pause: (
      <>
        <path d="M9 6v12" />
        <path d="M15 6v12" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5m0-8v.01" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 10h18" />
      </>
    ),
    close: (
      <>
        <path d="m6 6 12 12" />
        <path d="m18 6-12 12" />
      </>
    ),
    controls: (
      <>
        <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
        <circle cx="16" cy="7" r="2" />
        <circle cx="8" cy="17" r="2" />
      </>
    ),
    collapse: <path d="m15 18-6-6 6-6" />,
  };

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className = "",
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  label: string;
  className?: string;
}) {
  return (
    <div className={`segmented ${className}`} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          className={value === option.value ? "active" : ""}
          onClick={() => onChange(option.value)}
          role="radio"
          aria-checked={value === option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function MapGrid({
  mode,
  selected,
  onSelect,
}: {
  mode: DataMode;
  selected: number | null;
  onSelect: (value: number | null) => void;
}) {
  const cells = useMemo(() => {
    const result: { x: number; y: number; level: number; value: number }[] = [];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 14; col++) {
        const nx = (col - 6.5) / 7;
        const ny = (row - 3.5) / 4;
        const inside = nx * nx + ny * ny < 1.08 && !(row === 0 && col < 4) && !(row > 5 && col < 2);
        if (inside) {
          const base = (col * 7 + row * 11 + ((col * row) % 5)) % 29;
          const level =
            base > 25 ? 5 : base > 21 ? 4 : base > 15 ? 3 : base > 9 ? 2 : base > 4 ? 1 : 0;
          result.push({
            x: 315 + col * 34,
            y: 178 + row * 34,
            level: mode === "raw" ? level : Math.max(0, level - (base % 3 === 0 ? 1 : 0)),
            value: 4 + level * 17 + (base % 11),
          });
        }
      }
    }
    return result;
  }, [mode]);

  const picked = selected === null ? null : cells[selected];

  return (
    <div className="map-stage" aria-label="Map of weekly fire detections in Ukraine">
      <svg
        className="map-art"
        viewBox="0 0 1000 650"
        role="img"
        aria-label="Muted map of Ukraine and surrounding region"
      >
        <g className="map-land">
          <path d="M38 66 231 40l89 70 103-15 62 61-48 87-141 21-80 101-136-9-49-122Z" />
          <path d="m440 20 214 24 42 104-48 91-166-30-36-104Z" />
          <path d="m700 43 254 22 26 225-159 52-143-96 50-89Z" />
          <path d="m72 391 170-47 120 76-34 182H55Z" />
          <path d="m371 374 127-75 175 65 77 161-79 104-279-43Z" />
          <path d="m761 359 217-44v324H720l42-121Z" />
        </g>
        <g className="map-borders">
          <path d="M40 360 229 294l73 70 104-20 78 64" />
          <path d="m646 238 70 113 94-8 29 86" />
          <path d="m311 103 17 139-98 52" />
          <path d="m673 364-70 123 67 142" />
        </g>
        <g className="map-roads">
          <path d="M128 332 347 306l156 84 223-89" />
          <path d="m355 127-8 179 24 156" />
          <path d="m503 390 85-173 128 134" />
          <path d="m347 306 223-36 156 31" />
        </g>
        <g className="map-rivers">
          <path d="M502 132c-38 68 47 95-4 164s38 108 9 191 54 85 69 135" />
        </g>
        <g className="map-labels">
          <text x="106" y="185">
            POLAND
          </text>
          <text x="456" y="90">
            BELARUS
          </text>
          <text x="800" y="181">
            RUSSIA
          </text>
          <text x="160" y="534">
            ROMANIA
          </text>
          <text x="487" y="553">
            MOLDOVA
          </text>
          <text x="792" y="540">
            BLACK SEA
          </text>
          <text className="country" x="493" y="333">
            UKRAINE
          </text>
          <circle cx="501" cy="289" r="3" />
          <text className="city" x="510" y="285">
            Kyiv
          </text>
          <circle cx="690" cy="315" r="2.5" />
          <text className="city" x="699" y="312">
            Kharkiv
          </text>
          <circle cx="458" cy="441" r="2.5" />
          <text className="city" x="467" y="438">
            Odesa
          </text>
        </g>
        <g className="heat-cells">
          {cells.map((cell, index) => (
            <rect
              key={`${cell.x}-${cell.y}`}
              x={cell.x}
              y={cell.y}
              width="32"
              height="32"
              fill={ramp[cell.level]}
              className={selected === index ? "selected-cell" : ""}
              onClick={() => onSelect(index)}
              role="button"
              tabIndex={0}
              aria-label={`${cell.value} detections`}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelect(index);
              }}
            />
          ))}
        </g>
      </svg>
      {picked && (
        <button
          className="map-tooltip"
          onClick={() => onSelect(null)}
          aria-label="Close map cell details"
        >
          <span>Fire detections</span>
          <strong>{picked.value}</strong>
          <small>24–30 Jun 2024 · 0.5° cell</small>
        </button>
      )}
      <div className="map-zoom" aria-label="Map zoom controls">
        <button aria-label="Zoom in">+</button>
        <button aria-label="Zoom out">−</button>
      </div>
      <div className="legend">
        <span>Less</span>
        <div className="legend-ramp">
          {ramp.map((color) => (
            <i key={color} style={{ background: color }} />
          ))}
        </div>
        <span>More</span>
      </div>
      <div className="map-meta">0.5° grid · 24–30 Jun 2024</div>
    </div>
  );
}

function Metrics({ mode }: { mode: DataMode }) {
  const items =
    mode === "raw"
      ? [
          { label: "Latest week", value: "1,842", detail: "+18% vs normal", tone: "hot" },
          { label: "Sensor jump · 2012", value: "×2.8", detail: "Raw record break", tone: "warm" },
          { label: "Weeks in record", value: "1,235", detail: "Since Feb 2000", tone: "" },
        ]
      : [
          { label: "Latest week", value: "1,316", detail: "+6% vs normal", tone: "warm" },
          { label: "Sensor jump · 2012", value: "×0.9", detail: "Adjusted continuity", tone: "" },
          { label: "Weeks in record", value: "1,235", detail: "Since Feb 2000", tone: "" },
        ];
  return (
    <div className="metrics" aria-label="Key record numbers">
      {items.map((item) => (
        <article className="metric-card" key={item.label}>
          <div className="metric-label">{item.label}</div>
          <div className="metric-value">{item.value}</div>
          <div className={`metric-detail ${item.tone}`}>{item.detail}</div>
        </article>
      ))}
    </div>
  );
}

function CalendarHeatmap({
  mode,
  selectedWeek,
  setSelectedWeek,
}: {
  mode: DataMode;
  selectedWeek: number;
  setSelectedWeek: (week: number) => void;
}) {
  const years = [2020, 2021, 2022, 2023, 2024];
  return (
    <div className="calendar-wrap">
      <div className="months" aria-hidden="true">
        <span>Jan</span>
        <span>Apr</span>
        <span>Jul</span>
        <span>Oct</span>
      </div>
      <div className="calendar-grid">
        {years.map((year, row) => (
          <div className="calendar-row" key={year}>
            <span className="year">{year}</span>
            <div className="week-row">
              {Array.from({ length: 52 }, (_, week) => {
                const score = (week * 5 + row * 9 + (week % 7) * row) % 31;
                const level =
                  score > 27
                    ? 5
                    : score > 23
                      ? 4
                      : score > 17
                        ? 3
                        : score > 10
                          ? 2
                          : score > 4
                            ? 1
                            : 0;
                const isSelected = year === 2024 && week === selectedWeek;
                return (
                  <button
                    key={week}
                    style={{ background: ramp[mode === "raw" ? level : Math.max(0, level - 1)] }}
                    className={isSelected ? "week-selected" : ""}
                    onClick={() => setSelectedWeek(week)}
                    aria-label={`Week ${week + 1} of ${year}`}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DataPanel({
  mode,
  setMode,
  selectedWeek,
  setSelectedWeek,
  open,
  collapsed,
  onClose,
  onCollapse,
}: {
  mode: DataMode;
  setMode: (mode: DataMode) => void;
  selectedWeek: number;
  setSelectedWeek: (week: number) => void;
  open: boolean;
  collapsed: boolean;
  onClose: () => void;
  onCollapse: () => void;
}) {
  const [calendarView, setCalendarView] = useState<"counts" | "unusual">("counts");
  const [touchStart, setTouchStart] = useState<number | null>(null);

  return (
    <aside
      className={`data-panel ${open ? "drawer-open" : ""} ${collapsed ? "panel-collapsed" : ""}`}
      aria-label="History data controls"
      onClick={(event) => event.stopPropagation()}
      onTouchStart={(event) => setTouchStart(event.touches[0].clientY)}
      onTouchEnd={(event) => {
        if (touchStart !== null && event.changedTouches[0].clientY - touchStart > 90) onClose();
        setTouchStart(null);
      }}
    >
      <div className="panel-header">
        <div>
          <span className="eyebrow">Explore the record</span>
          <h1>History</h1>
        </div>
        <button className="close-panel mobile-only" onClick={onClose} aria-label="Close controls">
          <Icon name="close" size={22} />
        </button>
        <button
          className="collapse-panel desktop-only"
          onClick={onCollapse}
          aria-label="Collapse controls"
        >
          <Icon name="collapse" size={20} />
        </button>
      </div>
      <div className="panel-scroll">
        <div className="area-row">
          <button className="area-select">
            <span className="flag">UA</span>
            <span>Ukraine</span>
            <Icon name="chevron" size={16} />
          </button>
          <button className="draw-button">
            <Icon name="draw" size={17} /> Draw area
          </button>
        </div>

        <section className="mode-section">
          <Segmented
            value={mode}
            onChange={setMode}
            label="Satellite data treatment"
            options={[
              { value: "raw", label: "Raw satellites" },
              { value: "harmonized", label: "Harmonized" },
            ]}
          />
          <p>
            {mode === "raw"
              ? "Original sensor counts, with known instrument shifts."
              : "Sensors adjusted into one consistent long-term record."}
          </p>
        </section>

        <Metrics mode={mode} />

        <section className="calendar-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Weekly record</span>
              <h2>When did fire stand out?</h2>
            </div>
            <button className="icon-info" aria-label="About the weekly record">
              <Icon name="info" size={17} />
            </button>
          </div>
          <div className="calendar-controls">
            <Segmented
              value={calendarView}
              onChange={setCalendarView}
              label="Calendar display"
              className="compact"
              options={[
                { value: "counts", label: "Counts" },
                { value: "unusual", label: "Unusual weeks" },
              ]}
            />
            <span className="uncertainty">
              <i /> uncertainty
            </span>
          </div>
          <CalendarHeatmap
            mode={mode}
            selectedWeek={selectedWeek}
            setSelectedWeek={setSelectedWeek}
          />
          <button className="download-button">
            <Icon name="download" /> Download CSV
          </button>
        </section>
      </div>
    </aside>
  );
}

function Header({ theme, setTheme }: { theme: Theme; setTheme: (theme: Theme) => void }) {
  const [language, setLanguage] = useState<"EN" | "UA">("EN");
  return (
    <header className="topbar">
      <div className="brand-block">
        <a className="wordmark" href="#" aria-label="Kelvin367 home">
          Kelvin<span>367</span>
        </a>
        <span className="prototype-badge">Prototype · not endorsed by NASA</span>
      </div>
      <nav className="main-tabs" aria-label="Main navigation">
        <a className="active" href="#">
          History
        </a>
        <a href="#" onClick={(event) => event.preventDefault()}>
          Forecast <small>Next</small>
        </a>
      </nav>
      <div className="header-tools">
        <div className="language" aria-label="Language">
          <button className={language === "EN" ? "active" : ""} onClick={() => setLanguage("EN")}>
            EN
          </button>
          <span>/</span>
          <button className={language === "UA" ? "active" : ""} onClick={() => setLanguage("UA")}>
            UA
          </button>
        </div>
        <Segmented
          value={theme}
          onChange={setTheme}
          label="Color theme"
          className="theme-switch"
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
            { value: "system", label: "System" },
          ]}
        />
      </div>
    </header>
  );
}

function Scrubber({ week, setWeek }: { week: number; setWeek: (week: number) => void }) {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setWeek(week >= 51 ? 0 : week + 1), 650);
    return () => window.clearInterval(id);
  }, [playing, setWeek, week]);

  return (
    <div className="scrubber">
      <button
        className="play-button"
        onClick={() => setPlaying(!playing)}
        aria-label={playing ? "Pause timeline" : "Play timeline"}
      >
        <Icon name={playing ? "pause" : "play"} size={17} />
      </button>
      <span className="scrubber-date">24–30 Jun</span>
      <input
        type="range"
        min="0"
        max="51"
        value={week}
        onChange={(event) => setWeek(Number(event.target.value))}
        aria-label="Week of 2024"
        style={{ "--range": `${(week / 51) * 100}%` } as React.CSSProperties}
      />
      <span className="scrubber-year">2024</span>
      <button className="date-button" aria-label="Choose date">
        <Icon name="calendar" size={18} />
      </button>
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState<Theme>("light");
  const [systemDark, setSystemDark] = useState(false);
  const [mode, setMode] = useState<DataMode>("harmonized");
  const [selectedCell, setSelectedCell] = useState<number | null>(44);
  const [selectedWeek, setSelectedWeek] = useState(25);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const resolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  return (
    <div className="app" data-theme={resolvedTheme}>
      <Header theme={theme} setTheme={setTheme} />
      <main className="map-shell" onClick={() => drawerOpen && setDrawerOpen(false)}>
        <MapGrid mode={mode} selected={selectedCell} onSelect={setSelectedCell} />
        <button className="map-area-chip">
          <span className="flag">UA</span>
          <span>Ukraine</span>
          <Icon name="chevron" size={16} />
        </button>
        <DataPanel
          mode={mode}
          setMode={setMode}
          selectedWeek={selectedWeek}
          setSelectedWeek={setSelectedWeek}
          open={drawerOpen}
          collapsed={panelCollapsed}
          onClose={() => setDrawerOpen(false)}
          onCollapse={() => setPanelCollapsed(true)}
        />
        {panelCollapsed && (
          <button className="expand-panel desktop-only" onClick={() => setPanelCollapsed(false)}>
            <Icon name="controls" size={19} /> Controls
          </button>
        )}
        <Scrubber week={selectedWeek} setWeek={setSelectedWeek} />
        <button className="open-controls mobile-only" onClick={() => setDrawerOpen(true)}>
          <Icon name="controls" size={19} /> Controls
        </button>
      </main>
    </div>
  );
}
