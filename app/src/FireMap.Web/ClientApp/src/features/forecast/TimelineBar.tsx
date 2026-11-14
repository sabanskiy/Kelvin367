// Day-by-day playback of the loaded hot spots (port of timeline.js), in the Figma scrubber position.
// Off: shows the whole range with a per-day histogram; ▶ or a bar click turns it on.
// On: steps through days; in compare mode days are aligned by position (day n of A beside day n of B).
import { useEffect, type CSSProperties } from 'react';
import { Icon } from '../../components/Icon';
import { useI18n } from '../../i18n';
import { longDate, shortDate } from '../../lib/dates';
import type { Period } from './HotspotLayers';

export interface TimelinePeriod extends Period {
  days: string[];
}

export function TimelineBar({
  periods,
  counts,
  on,
  index,
  playing,
  speed,
  onIndex,
  onPlaying,
  onSpeed,
  onClose,
}: {
  periods: TimelinePeriod[];
  counts: Partial<Record<Period['key'], Map<string, number>>>;
  on: boolean;
  index: number;
  playing: boolean;
  speed: number;
  onIndex: (i: number) => void;
  onPlaying: (p: boolean) => void;
  onSpeed: (ms: number) => void;
  onClose: () => void;
}) {
  const { t, nf, locale } = useI18n();
  const length = Math.max(0, ...periods.map((p) => p.days.length));
  const multi = periods.length > 1;
  const wrap = (i: number) => (length ? ((i % length) + length) % length : 0);

  useEffect(() => {
    if (!on || !playing || length === 0) return;
    const id = window.setInterval(() => onIndex(wrap(index + 1)), speed);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, playing, index, length, speed, onIndex]);

  const count = (p: TimelinePeriod, i: number) => {
    const day = p.days[i];
    return day ? counts[p.key]?.get(day) ?? 0 : 0;
  };
  let max = 1;
  for (const p of periods) for (let i = 0; i < p.days.length; i++) max = Math.max(max, count(p, i));

  const go = (i: number) => {
    onPlaying(false); // manual control takes over
    onIndex(wrap(i));
  };

  const a = periods[0];
  const startLabel = multi ? t('tl.dayN', { n: 1 }) : shortDate(a?.days[0], locale);
  const endLabel = multi ? t('tl.dayN', { n: length }) : shortDate(a?.days.at(-1), locale);

  return (
    <div className={`scrubber timeline ${on ? 'on' : 'off'} ${multi ? 'comparing' : ''}`} role="group" aria-label={t('tl.aria')}>
      <div className="tl-buttons">
        {on && (
          <button type="button" className="tl-btn" onClick={() => go(index - 1)} aria-label={t('tl.prev')}>
            <Icon name="prev" size={16} />
          </button>
        )}
        <button
          type="button"
          className="play-button"
          onClick={() => onPlaying(!(on && playing))}
          aria-label={on && playing ? t('scrub.pause') : t('scrub.play')}
          aria-pressed={on && playing}
        >
          <Icon name={on && playing ? 'pause' : 'play'} size={17} />
        </button>
        {on && (
          <button type="button" className="tl-btn" onClick={() => go(index + 1)} aria-label={t('tl.next')}>
            <Icon name="next" size={16} />
          </button>
        )}
      </div>

      <div className="tl-track">
        <div className="tl-bars">
          {Array.from({ length }, (_, i) => {
            const title = periods.map((p) => `${p.days[i] ?? '—'}: ${nf(count(p, i))}`).join(' | ');
            return (
              <button type="button" key={i} className={`tl-bar${on && i === index ? ' current' : ''}`} onClick={() => go(i)} title={title} aria-label={title} tabIndex={-1}>
                {periods.map((p) => {
                  const c = count(p, i);
                  const h = c === 0 ? 0 : Math.max(6, (c / max) * 100);
                  return <span key={p.key} style={{ height: `${h}%`, '--c': p.color } as CSSProperties} />;
                })}
              </button>
            );
          })}
        </div>
        {on ? (
          <input
            type="range"
            min={0}
            max={Math.max(0, length - 1)}
            value={index}
            onChange={(e) => go(Number(e.target.value))}
            aria-label={t('scrub.aria')}
            aria-valuetext={periods.map((p) => p.days[index] ?? '—').join(' | ')}
            style={{ '--range': `${length > 1 ? (index / (length - 1)) * 100 : 0}%` } as CSSProperties}
          />
        ) : null}
        <div className="tl-axis">
          <span>{startLabel}</span>
          <span>{endLabel}</span>
        </div>
      </div>

      <div className="tl-info">
        {on ? (
          <>
            <div className="tl-date">
              {periods.map((p) => (
                <span className="tl-period" key={p.key}>
                  {multi && <span className="dot" style={{ '--c': p.color } as CSSProperties} />}
                  {p.days[index] ? longDate(p.days[index], locale) : '—'}
                </span>
              ))}
            </div>
            <div className="tl-count">
              {periods.map((p) => (multi ? `${p.key} ${nf(count(p, index))}` : t('tl.detections', { n: nf(count(p, index)) }))).join(' · ')} ·{' '}
              {t('tl.position', { i: index + 1, n: length })}
            </div>
          </>
        ) : (
          <div className="tl-date">
            {periods.map((p) => (
              <span className="tl-period" key={p.key}>
                {multi && <span className="dot" style={{ '--c': p.color } as CSSProperties} />}
                {p.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {on && (
        <div className="tl-extra">
          <label className="tl-speed">
            <span>{t('tl.speed')}</span>
            <select value={speed} onChange={(e) => onSpeed(Number(e.target.value))}>
              <option value={500}>0.5 s</option>
              <option value={1000}>1 s</option>
              <option value={2000}>2 s</option>
            </select>
          </label>
          <button type="button" className="tl-btn" onClick={onClose} aria-label={t('tl.close')} title={t('tl.close')}>
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
