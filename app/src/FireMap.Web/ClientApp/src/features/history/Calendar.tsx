// Week × year calendar heatmap on a canvas (port of spacechallenge drawCalendar / wireCalendar).
// Click or Enter selects a week (the map and scrubber follow); arrows move a keyboard cursor whose
// values are read out through a live region.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { addDays } from '../../lib/dates';
import { cssVar, type Theme } from '../../lib/theme';
import type { CalendarView, HistoryMode } from '../../lib/hashState';
import { divColor, quantile, seqColor, type Prepared, type Shown } from './model';

const LEFT = 40, TOP = 20, ROW_H = 14;

interface Geom {
  cellW: number;
  rowOf: Map<number, number>;
  years: number[];
}

export function Calendar({
  data,
  shown,
  pct,
  view,
  mode,
  selected,
  onSelect,
  years,
  theme,
}: {
  data: Prepared;
  shown: Shown;
  pct: (number | null)[];
  view: CalendarView;
  mode: HistoryMode;
  selected: number;
  onSelect: (i: number) => void;
  /** Years to draw (all, or the last three on mobile). */
  years: number[];
  theme: Theme;
}) {
  const { t, nf, lang } = useI18n();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const geom = useRef<Geom | null>(null);
  const [width, setWidth] = useState(0);
  const [cursor, setCursor] = useState<{ year: number; col: number } | null>(null);
  const [tip, setTip] = useState<{ i: number; x: number; y: number } | null>(null);
  const [live, setLive] = useState('');

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const weekAt = useCallback(
    (year: number, col: number) => {
      for (let i = 0; i < data.weeks.length; i++) if (data.year[i] === year && data.woy[i] === col) return i;
      return -1;
    },
    [data],
  );

  // ---- draw ------------------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width) return;
    const ctx = canvas.getContext('2d')!;
    const cellW = Math.max(9, Math.floor((width - LEFT - 4) / 52));
    const w = LEFT + cellW * 52 + 4, h = TOP + ROW_H * years.length + 4, dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const muted = cssVar('--muted'), line = cssVar('--border');
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.fillStyle = muted;
    ctx.textBaseline = 'middle';
    t('months')
      .split(',')
      .forEach((m, i) => {
        const wk = Math.floor((Date.UTC(2021, i, 1) - Date.UTC(2021, 0, 1)) / 86_400_000 / 7);
        if (cellW >= 9 || i % 3 === 0) ctx.fillText(m, LEFT + wk * cellW, 9);
      });
    const rowOf = new Map(years.map((y, i) => [y, i]));
    years.forEach((y, r) => {
      if (y % 2 === 0 || years.length < 14) ctx.fillText(String(y), 2, TOP + r * ROW_H + ROW_H / 2);
    });

    const unusual = view === 'unusual';
    const vmax = quantile(shown.est, 0.99) || 1;
    for (let i = 0; i < data.weeks.length; i++) {
      const row = rowOf.get(data.year[i]);
      if (row === undefined) continue;
      const x = LEFT + data.woy[i] * cellW, y = TOP + row * ROW_H;
      const v = shown.est[i];
      if (v == null || (unusual && pct[i] == null)) ctx.fillStyle = line;
      else ctx.fillStyle = unusual ? divColor(pct[i]!) : seqColor(v, vmax);
      ctx.fillRect(x, y + 1, cellW - 1, ROW_H - 2);
      if (data.gapAny.has(i)) {
        ctx.strokeStyle = 'rgba(0,0,0,.65)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y + ROW_H - 1);
        ctx.lineTo(x + cellW - 1, y + 1);
        ctx.stroke();
      }
    }

    const ring = (i: number, color: string, lw: number) => {
      const row = rowOf.get(data.year[i]);
      if (i < 0 || row === undefined) return;
      ctx.lineWidth = lw;
      ctx.strokeStyle = color;
      ctx.strokeRect(LEFT + data.woy[i] * cellW - 0.5, TOP + row * ROW_H + 0.5, cellW, ROW_H - 1);
    };
    ring(selected, cssVar('--indigo'), 2.5); // the week shown on the map
    if (cursor) {
      // two-tone keyboard ring: visible on light and dark cells
      const i = weekAt(cursor.year, cursor.col);
      ring(i, '#ffffff', 3);
      ring(i, '#000000', 1.5);
    }
    geom.current = { cellW, rowOf, years };
  }, [data, shown, pct, view, selected, cursor, years, width, theme, lang, t, weekAt]);

  // Keep the selected week in view when it changes (e.g. while the scrubber plays).
  useEffect(() => {
    const g = geom.current, el = wrapRef.current;
    if (!g || !el || el.scrollWidth <= el.clientWidth) return;
    const x = LEFT + data.woy[selected] * g.cellW;
    if (x < el.scrollLeft + LEFT || x > el.scrollLeft + el.clientWidth - g.cellW) el.scrollLeft = Math.max(0, x - el.clientWidth / 2);
  }, [selected, data]);

  // ---- tooltip text ------------------------------------------------------------------------------
  const tipLines = (i: number): string[] => {
    const s = data.series;
    const lines = [t('tip.week', { from: data.weeks[i], to: addDays(data.weeks[i], 6) })];
    lines.push(t('tip.modis', { v: nf(s.modis[i]) }));
    if (s.viirs_snpp) lines.push(t('tip.snpp', { v: nf(s.viirs_snpp[i]) }));
    if (s.viirs_noaa20) lines.push(t('tip.noaa20', { v: nf(s.viirs_noaa20[i]) }));
    if (s.viirs_noaa21 && (s.viirs_noaa21[i] ?? 0) > 0) lines.push(t('tip.noaa21', { v: nf(s.viirs_noaa21[i]) }));
    if (mode === 'raw' && s.naive) lines.push(t('tip.stitched', { v: nf(shown.est[i]), src: shown.src[i] }));
    else {
      const lo = shown.lo[i], hi = shown.hi[i];
      const iv = lo != null && hi != null && lo !== hi ? ` [${nf(lo)} - ${nf(hi)}]` : '';
      lines.push(t('tip.harm', { v: nf(shown.est[i]), iv, src: shown.src[i] || t('common.na') }));
    }
    if (pct[i] != null) lines.push(t('tip.pct', { v: nf(pct[i], 0) }));
    if (data.gapAny.has(i)) lines.push(t('tip.gap'));
    return lines;
  };

  // ---- pointer -----------------------------------------------------------------------------------
  const hitTest = (clientX: number, clientY: number) => {
    const g = geom.current, c = canvasRef.current;
    if (!g || !c) return -1;
    const r = c.getBoundingClientRect();
    const col = Math.floor((clientX - r.left - LEFT) / g.cellW), row = Math.floor((clientY - r.top - TOP) / ROW_H);
    if (col < 0 || col > 51 || row < 0 || row >= g.years.length) return -1;
    return weekAt(g.years[row], col);
  };

  const tipAt = (i: number) => {
    const g = geom.current, c = canvasRef.current, wrap = wrapRef.current;
    if (!g || !c || !wrap || i < 0) return null;
    const row = g.rowOf.get(data.year[i]);
    if (row === undefined) return null;
    return { i, x: LEFT + data.woy[i] * g.cellW - wrap.scrollLeft, y: TOP + row * ROW_H };
  };

  // ---- keyboard ----------------------------------------------------------------------------------
  const moveCursor = (year: number, col: number) => {
    year = Math.max(years[0], Math.min(years[years.length - 1], year));
    col = Math.max(0, Math.min(51, col));
    setCursor({ year, col });
    const i = weekAt(year, col);
    setLive(i < 0 ? `${year}: ${t('common.na')}` : tipLines(i).join('. '));
    setTip(tipAt(i));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    let c = cursor;
    if (!c) {
      c = { year: data.year[selected], col: data.woy[selected] };
    }
    let { year, col } = c;
    const first = years[0], last = years[years.length - 1];
    switch (e.key) {
      case 'ArrowRight':
        col++;
        if (col > 51) {
          if (year < last) { year++; col = 0; } else col = 51;
        }
        break;
      case 'ArrowLeft':
        col--;
        if (col < 0) {
          if (year > first) { year--; col = 51; } else col = 0;
        }
        break;
      case 'ArrowDown': year++; break;
      case 'ArrowUp': year--; break;
      case 'PageDown': year += 5; break;
      case 'PageUp': year -= 5; break;
      case 'Home': col = 0; break;
      case 'End': col = 51; break;
      case 'Enter':
      case ' ': {
        const i = weekAt(year, col);
        if (i >= 0) onSelect(i);
        e.preventDefault();
        return;
      }
      case 'Escape':
        setCursor(null);
        setTip(null);
        return;
      default:
        return;
    }
    e.preventDefault();
    moveCursor(year, col);
  };

  const tipStyle = tip ? { left: Math.max(0, Math.min(tip.x + 14, width - 250)), top: tip.y + ROW_H + 6 } : undefined;

  return (
    <div className="calendar-box">
      <div className="calendar-wrap" ref={wrapRef} onScroll={() => setTip(null)}>
        <canvas
          ref={canvasRef}
          tabIndex={0}
          role="application"
          aria-label={t('cal.aria')}
          aria-describedby="cal-keys"
          onClick={(e) => {
            const i = hitTest(e.clientX, e.clientY);
            if (i >= 0) {
              onSelect(i);
              setTip(tipAt(i));
            }
          }}
          onMouseMove={(e) => {
            if (cursor) return;
            const i = hitTest(e.clientX, e.clientY);
            setTip(i >= 0 ? tipAt(i) : null);
          }}
          onMouseLeave={() => !cursor && setTip(null)}
          onKeyDown={onKeyDown}
          onFocus={() => !cursor && moveCursor(data.year[selected], data.woy[selected])}
          onBlur={() => {
            setCursor(null);
            setTip(null);
          }}
        />
      </div>
      {tip && (
        <div className="cal-tip" style={tipStyle} role="presentation">
          {tipLines(tip.i).map((l, k) => (
            <div key={k} className={k === 0 ? 'cal-tip-head' : ''}>
              {l}
            </div>
          ))}
        </div>
      )}
      <p id="cal-keys" className="sr-only">
        {t('cal.keys')}
      </p>
      <div className="sr-only" aria-live="polite">
        {live}
      </div>
    </div>
  );
}
