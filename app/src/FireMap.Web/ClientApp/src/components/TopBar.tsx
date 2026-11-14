// Figma top bar: wordmark + prototype badge, History | Forecast tabs, EN/UA, theme switch, About.
import { Icon } from './Icon';
import { Segmented } from './Segmented';
import { useI18n, type Lang } from '../i18n';
import type { ThemeChoice } from '../lib/theme';
import type { Tab } from '../lib/hashState';

export function TopBar({
  tab,
  onTab,
  theme,
  onTheme,
  onAbout,
}: {
  tab: Tab;
  onTab: (tab: Tab) => void;
  theme: ThemeChoice;
  onTheme: (t: ThemeChoice) => void;
  onAbout: () => void;
}) {
  const { t, lang, setLang } = useI18n();
  const tabLink = (id: Tab, label: string, extra?: string) => (
    <a
      href={`#${id}`}
      className={tab === id ? 'active' : ''}
      aria-current={tab === id ? 'page' : undefined}
      onClick={(e) => {
        e.preventDefault();
        onTab(id);
      }}
    >
      {label}
      {extra && <small>{extra}</small>}
    </a>
  );

  return (
    <header className="topbar">
      <div className="brand-block">
        <a
          className="wordmark"
          href="#history"
          aria-label={t('app.home')}
          onClick={(e) => {
            e.preventDefault();
            onTab('history');
          }}
        >
          Kelvin<span>367</span>
        </a>
        <span className="prototype-badge" title={t('app.tagline')}>
          {t('app.badge')}
        </span>
      </div>
      <nav className="main-tabs" aria-label={t('tab.aria')}>
        {tabLink('history', t('tab.history'))}
        {tabLink('forecast', t('tab.forecast'), t('tab.forecast.tag'))}
      </nav>
      <div className="header-tools">
        <div className="language" role="group" aria-label={t('lang.aria')}>
          {(['en', 'uk'] as Lang[]).map((l, i) => (
            <span key={l} className="language-item">
              {i > 0 && <span aria-hidden="true">/</span>}
              <button type="button" className={lang === l ? 'active' : ''} aria-pressed={lang === l} onClick={() => setLang(l)} lang={l}>
                {l === 'en' ? 'EN' : 'UA'}
              </button>
            </span>
          ))}
        </div>
        <Segmented
          value={theme}
          onChange={onTheme}
          label={t('theme.aria')}
          className="theme-switch"
          options={[
            { value: 'light', label: t('theme.light') },
            { value: 'dark', label: t('theme.dark') },
            { value: 'system', label: t('theme.system') },
          ]}
        />
        <button type="button" className="icon-button about-button" onClick={onAbout} aria-label={t('about.open')} title={t('about.open')}>
          <Icon name="info" size={20} />
        </button>
      </div>
    </header>
  );
}
