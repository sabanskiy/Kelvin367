// Figma week/day scrubber at the bottom of the map: play/pause, label, range, trailing slot.
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { Icon } from './Icon';
import { useI18n } from '../i18n';

export function Scrubber({
  index,
  max,
  onChange,
  playing,
  onPlaying,
  intervalMs = 650,
  label,
  sublabel,
  ariaLabel,
  ariaValueText,
  before,
  after,
  className = '',
}: {
  index: number;
  max: number;
  onChange: (i: number) => void;
  playing: boolean;
  onPlaying: (p: boolean) => void;
  intervalMs?: number;
  label: ReactNode;
  sublabel?: ReactNode;
  ariaLabel: string;
  ariaValueText?: string;
  before?: ReactNode;
  after?: ReactNode;
  className?: string;
}) {
  const { t } = useI18n();

  // Loop around at the end, like the old timeline.
  useEffect(() => {
    if (!playing || max <= 0) return;
    const id = window.setInterval(() => onChange(index >= max ? 0 : index + 1), intervalMs);
    return () => window.clearInterval(id);
  }, [playing, index, max, intervalMs, onChange]);

  const pct = max > 0 ? (index / max) * 100 : 0;
  return (
    <div className={`scrubber ${className}`}>
      <button
        type="button"
        className="play-button"
        onClick={() => onPlaying(!playing)}
        aria-label={playing ? t('scrub.pause') : t('scrub.play')}
        aria-pressed={playing}
      >
        <Icon name={playing ? 'pause' : 'play'} size={17} />
      </button>
      {before}
      <span className="scrubber-date">{label}</span>
      <input
        type="range"
        min={0}
        max={Math.max(0, max)}
        value={index}
        onChange={(e) => {
          onPlaying(false); // manual control takes over
          onChange(Number(e.target.value));
        }}
        aria-label={ariaLabel}
        aria-valuetext={ariaValueText}
        style={{ '--range': `${pct}%` } as CSSProperties}
      />
      {sublabel != null && <span className="scrubber-year">{sublabel}</span>}
      {after}
    </div>
  );
}
