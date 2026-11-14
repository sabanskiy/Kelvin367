// EN/UA translations. Language order: ?lang= → saved choice → browser language → English.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en, type MessageKey } from './en';
import { uk } from './uk';
import { localeOf } from '../lib/dates';

export type Lang = 'en' | 'uk';
export type Params = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: Params) => string;

const DICTS: Record<Lang, Record<MessageKey, string>> = { en, uk };
const STORAGE_KEY = 'k367.lang';

export function translate(lang: Lang, key: MessageKey, params?: Params): string {
  const s = DICTS[lang][key] ?? en[key] ?? key;
  return params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s;
}

function initialLang(): Lang {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'en' || q === 'uk') return q;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'uk') return saved;
  } catch {
    /* storage may be unavailable */
  }
  return /^uk/i.test(navigator.language || '') ? 'uk' : 'en';
}

interface I18n {
  lang: Lang;
  locale: string;
  setLang: (lang: Lang) => void;
  t: Translate;
  /** Locale-aware number, "n/a" for null/NaN. */
  nf: (v: number | null | undefined, digits?: number) => string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = translate(lang, 'app.title');
  }, [lang]);

  const value = useMemo<I18n>(() => {
    const locale = localeOf(lang);
    return {
      lang,
      locale,
      setLang,
      t: (key, params) => translate(lang, key, params),
      nf: (v, digits = 0) =>
        v === null || v === undefined || Number.isNaN(v)
          ? translate(lang, 'common.na')
          : Number(v).toLocaleString(locale, { maximumFractionDigits: digits }),
    };
  }, [lang, setLang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}

export type { MessageKey };
