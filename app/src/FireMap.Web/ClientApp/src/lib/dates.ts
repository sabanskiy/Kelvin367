// Date helpers. Dates are yyyy-mm-dd strings in UTC throughout the app.

const DAY_MS = 86_400_000;

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Same calendar day n years later/earlier (29 Feb → 28 Feb in non-leap years). */
export function shiftYears(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const year = y + n;
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${year}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY_MS);
}

export function enumerateDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

const fmtDate = (iso: string, locale: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString(locale, { timeZone: 'UTC', ...opts });

export function rangeLabel(from: string, to: string, locale: string): string {
  return from.slice(0, 4) === to.slice(0, 4)
    ? `${fmtDate(from, locale, { day: 'numeric', month: 'short' })} – ${fmtDate(to, locale, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : `${fmtDate(from, locale, { day: 'numeric', month: 'short', year: 'numeric' })} – ${fmtDate(to, locale, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export const longDate = (iso: string, locale: string) =>
  fmtDate(iso, locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

export const shortDate = (iso: string | undefined, locale: string) =>
  iso ? fmtDate(iso, locale, { day: 'numeric', month: 'short' }) : '';

/** "24–30 Jun" for a week that starts on `weekStart`. */
export function weekLabel(weekStart: string, locale: string): string {
  const end = addDays(weekStart, 6);
  const sameMonth = weekStart.slice(5, 7) === end.slice(5, 7);
  return sameMonth
    ? `${Number(weekStart.slice(8, 10))}–${fmtDate(end, locale, { day: 'numeric', month: 'short' })}`
    : `${fmtDate(weekStart, locale, { day: 'numeric', month: 'short' })} – ${fmtDate(end, locale, { day: 'numeric', month: 'short' })}`;
}

/** BCP-47 locale for number/date formatting from the UI language. */
export const localeOf = (lang: string) => (lang === 'uk' ? 'uk-UA' : 'en-GB');
