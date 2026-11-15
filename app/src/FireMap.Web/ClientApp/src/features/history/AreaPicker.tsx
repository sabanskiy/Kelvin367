// Area picker: our own select-only combobox, because a native <select> cannot show icons. The control
// and every option carry the map-pin icon; the list opens under the control's left corner.
// Keyboard (WAI-ARIA select-only combobox): Enter, Space or arrows open; arrows, Home and End move;
// Enter or Space picks; Esc closes; Tab closes and moves on.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../../components/Icon';

export interface AreaOption {
  value: string;
  label: string;
}

export function AreaPicker({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: string;
  options: AreaOption[];
  onChange: (value: string) => void;
  /** Accessible name of the control, e.g. "Area of interest". */
  label: string;
  className: string;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = Math.max(0, options.findIndex((o) => o.value === value));

  // Close on a pointer press outside the picker.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Keep the highlighted option in view.
  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const openList = () => {
    setActive(selected);
    setOpen(true);
  };

  const choose = (i: number) => {
    setOpen(false);
    buttonRef.current?.focus();
    const o = options[i];
    if (o && o.value !== value) onChange(o.value);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openList();
      }
      return;
    }
    const last = options.length - 1;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((a) => Math.min(last, a + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((a) => Math.max(0, a - 1));
        break;
      case 'Home':
        e.preventDefault();
        setActive(0);
        break;
      case 'End':
        e.preventDefault();
        setActive(last);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        choose(active);
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  return (
    <div ref={rootRef} className={`area-picker ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        className="area-picker-button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
      >
        <span className="area-icon" aria-hidden="true">
          <Icon name="area" size={24} />
        </span>
        <span className="area-picker-value">{options[selected]?.label ?? ''}</span>
        <Icon name="chevron" size={16} />
      </button>
      {open && (
        <ul ref={listRef} id={`${id}-list`} role="listbox" aria-label={label} className="area-list">
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-${i}`}
              data-index={i}
              role="option"
              aria-selected={o.value === value}
              className={i === active ? 'active' : undefined}
              onPointerEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              <Icon name="area" size={16} />
              <span>{o.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
