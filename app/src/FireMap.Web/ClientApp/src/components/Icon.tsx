// Outline icons (Figma set + a few for the map tools). 24×24 grid, stroke = currentColor.
import type { ReactElement } from 'react';

const PATHS = {
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
  prev: (
    <>
      <path d="M7 6v12" />
      <path d="m18 6-8 6 8 6Z" />
    </>
  ),
  next: (
    <>
      <path d="M17 6v12" />
      <path d="m6 6 8 6-8 6Z" />
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
  rect: <rect x="4" y="6" width="16" height="12" rx="1.5" />,
  flag: <path d="M5 4v16M5 5h11l-2 3.5L16 12H5" />,
  compare: <path d="M7 4 3 8l4 4M3 8h13M17 12l4 4-4 4M21 16H8" />,
  timeline: (
    <>
      <path d="M3 12h18" />
      <path d="M7 8v8M12 6v12M17 9v6" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }): ReactElement {
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
      {PATHS[name]}
    </svg>
  );
}
