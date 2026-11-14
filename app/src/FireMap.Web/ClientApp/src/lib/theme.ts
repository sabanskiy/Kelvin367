// Light / Dark / System theme. The resolved theme goes on <html data-theme>, where the CSS tokens read it.
import { useEffect, useState } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'k367.theme';

function initialChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* ignore */
  }
  return 'system';
}

export function useTheme(): { choice: ThemeChoice; setChoice: (c: ThemeChoice) => void; theme: Theme } {
  const [choice, setChoiceState] = useState<ThemeChoice>(initialChoice);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const q = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(q.matches);
    q.addEventListener('change', update);
    return () => q.removeEventListener('change', update);
  }, []);

  const theme: Theme = choice === 'system' ? (systemDark ? 'dark' : 'light') : choice;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setChoice = (c: ThemeChoice) => {
    setChoiceState(c);
    try {
      localStorage.setItem(STORAGE_KEY, c);
    } catch {
      /* ignore */
    }
  };

  return { choice, setChoice, theme };
}

/** Read a CSS custom property (period colours, palette) from the current theme. */
export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** True below the Figma mobile breakpoint. */
export function useIsMobile(): boolean {
  const query = '(max-width: 760px)';
  const [mobile, setMobile] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const q = window.matchMedia(query);
    const update = () => setMobile(q.matches);
    q.addEventListener('change', update);
    return () => q.removeEventListener('change', update);
  }, []);
  return mobile;
}
