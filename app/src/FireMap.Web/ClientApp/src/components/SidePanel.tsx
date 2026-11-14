// The Figma data panel: a 420 px card on the left of the map on desktop (collapsible), a bottom
// drawer on mobile (opens from the "Controls" button, closes with ×, a swipe down or a tap on the map).
import { useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { useI18n } from '../i18n';

export function SidePanel({
  eyebrow,
  title,
  label,
  open,
  collapsed,
  onClose,
  onCollapse,
  onExpand,
  children,
}: {
  eyebrow: string;
  title: string;
  label: string;
  open: boolean;
  collapsed: boolean;
  onClose: () => void;
  onCollapse: () => void;
  onExpand: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <aside
        className={`data-panel ${open ? 'drawer-open' : ''} ${collapsed ? 'panel-collapsed' : ''}`}
        aria-label={label}
        onTouchStart={(e) => {
          // Swipe-to-close only from the header or when the content is scrolled to the top.
          const atTop = (scrollRef.current?.scrollTop ?? 0) <= 0;
          setTouchStart(atTop ? e.touches[0].clientY : null);
        }}
        onTouchEnd={(e) => {
          if (touchStart !== null && e.changedTouches[0].clientY - touchStart > 90) onClose();
          setTouchStart(null);
        }}
      >
        <div className="panel-header">
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h1>{title}</h1>
          </div>
          <button type="button" className="close-panel mobile-only" onClick={onClose} aria-label={t('panel.close')}>
            <Icon name="close" size={22} />
          </button>
          <button type="button" className="collapse-panel desktop-only" onClick={onCollapse} aria-label={t('panel.collapse')}>
            <Icon name="collapse" size={20} />
          </button>
        </div>
        <div className="panel-scroll" ref={scrollRef}>
          {children}
        </div>
      </aside>
      {collapsed && (
        <button type="button" className="expand-panel desktop-only" onClick={onExpand}>
          <Icon name="controls" size={19} /> {t('panel.controls')}
        </button>
      )}
    </>
  );
}

/** Mobile-only floating button that opens the drawer. */
export function OpenControlsButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button type="button" className="open-controls mobile-only" onClick={onClick}>
      <Icon name="controls" size={19} /> {t('panel.controls')}
    </button>
  );
}
