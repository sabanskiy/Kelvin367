// Statistics for the selected area: one period, or Period A vs Period B (port of panel.js).
import type { StatsResult, LayerStats, DailyStat } from '../../lib/api';
import type { Days, Period } from './HotspotLayers';
import { useI18n } from '../../i18n';

export function StatsView({
  results,
  periods,
  layerNames,
  days,
}: {
  results: StatsResult[];
  periods: Period[];
  layerNames: Record<string, string>;
  days: Days;
}) {
  const { t, nf } = useI18n();
  const area = results[0].area;
  const multi = periods.length > 1;

  return (
    <div className="stats">
      <div className="stats-area">
        <div className="area-name">{area.name}</div>
        <div className="muted">{nf(area.areaKm2)} km²</div>
        {periods.map((p, i) => {
          const n = results[i]?.layers[0]?.daily.length ?? 0;
          return (
            <div className="muted period-line" key={p.key}>
              {multi && (
                <>
                  <span className="dot" style={{ '--c': p.color } as React.CSSProperties} />
                  {t('stats.periodPrefix', { k: p.key })}
                </>
              )}
              {t('stats.range', { from: p.from, to: p.to, n })}
            </div>
          );
        })}
      </div>
      {results.some((r) => r.partial) && <div className="stats-warn">{t('stats.partial')}</div>}
      {!multi ? (
        <PeriodDetails r={results[0]} periodKey="A" layerNames={layerNames} days={days} />
      ) : (
        <>
          <PeriodComparison results={results} periods={periods} layerNames={layerNames} days={days} />
          {periods.map((p, i) => (
            <details className="period-details" open={i === 0} key={p.key}>
              <summary>
                <span className="dot" style={{ '--c': p.color } as React.CSSProperties} />
                {t('stats.periodDetails', { k: p.key })} <span className="muted">{p.label}</span>
              </summary>
              <PeriodDetails r={results[i]} periodKey={p.key} layerNames={layerNames} days={days} />
            </details>
          ))}
        </>
      )}
    </div>
  );
}

function PeriodDetails({ r, periodKey, layerNames, days }: { r: StatsResult; periodKey: Period['key']; layerNames: Record<string, string>; days: Days }) {
  const { t, nf } = useI18n();
  return (
    <>
      {r.layers.map((s) => (
        <LayerCard s={s} key={s.layerId} current={days?.[periodKey] ?? null} />
      ))}
      {r.comparisons.length > 0 && (
        <div className="compare">
          <h3>{t('stats.sensors')}</h3>
          {r.comparisons.map((c) => (
            <div className="compare-row" key={c.layerA + c.layerB}>
              <span>
                {layerNames[c.layerA] || c.layerA} vs {layerNames[c.layerB] || c.layerB}
              </span>
              <span>
                {t('stats.ratio', {
                  c: c.countRatio == null ? '–' : nf(c.countRatio, 2) + '×',
                  f: c.frpRatio == null ? '–' : nf(c.frpRatio, 2) + '×',
                })}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Change({ a, b }: { a: number; b: number }) {
  const { t, nf } = useI18n();
  if (!b) return <td className="chg">{a ? t('stats.new') : '–'}</td>;
  const pct = ((a - b) / b) * 100;
  const cls = pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : '';
  return (
    <td className={`chg ${cls}`}>
      {pct > 0 ? '+' : ''}
      {nf(pct, 0)}%
    </td>
  );
}

function PeriodComparison({ results, periods, layerNames, days }: { results: StatsResult[]; periods: Period[]; layerNames: Record<string, string>; days: Days }) {
  const { t, nf } = useI18n();
  const [a, b] = results;
  const [pa, pb] = periods;
  return (
    <div className="period-compare">
      <h3>{t('stats.aVsB')}</h3>
      <table className="pc-table">
        <thead>
          <tr>
            <th />
            <th>
              <span className="dot" style={{ '--c': pa.color } as React.CSSProperties} />A
            </th>
            <th>
              <span className="dot" style={{ '--c': pb.color } as React.CSSProperties} />B
            </th>
            <th title={t('stats.aVsB.title')}>A vs B</th>
          </tr>
        </thead>
        {a.layers.map((la) => {
          const lb = b.layers.find((x) => x.layerId === la.layerId);
          if (!lb) return null;
          return (
            <tbody key={la.layerId}>
              <tr className="pc-layer">
                <th colSpan={4}>{layerNames[la.layerId] || la.name}</th>
              </tr>
              <tr>
                <td>{t('stats.detections')}</td>
                <td>{nf(la.count)}</td>
                <td>{nf(lb.count)}</td>
                <Change a={la.count} b={lb.count} />
              </tr>
              <tr>
                <td>{t('stats.totalFrpMw')}</td>
                <td>{nf(la.frp.sum)}</td>
                <td>{nf(lb.frp.sum)}</td>
                <Change a={la.frp.sum} b={lb.frp.sum} />
              </tr>
              <tr>
                <td>{t('stats.meanFrpMw')}</td>
                <td>{nf(la.frp.mean, 1)}</td>
                <td>{nf(lb.frp.mean, 1)}</td>
                <Change a={la.frp.mean} b={lb.frp.mean} />
              </tr>
            </tbody>
          );
        })}
      </table>
      <DualDailyChart results={results} periods={periods} days={days} />
    </div>
  );
}

/** Total detections per day (all selected layers) — A and B side by side for each day number. */
function DualDailyChart({ results, periods, days }: { results: StatsResult[]; periods: Period[]; days: Days }) {
  const { t, nf } = useI18n();
  const series = results.map((r) => {
    const n = r.layers[0]?.daily.length ?? 0;
    return Array.from({ length: n }, (_, i) => ({
      date: r.layers[0].daily[i].date,
      count: r.layers.reduce((sum, l) => sum + (l.daily[i]?.count ?? 0), 0),
    }));
  });
  const len = Math.max(...series.map((s) => s.length));
  if (len < 2) return null;
  const max = Math.max(1, ...series.flat().map((d) => d.count));
  const w = 300, h = 60, gap = len > 20 ? 1 : 2;
  const gw = (w - gap * (len - 1)) / len;
  const bw = gw / series.length;
  const bars = [];
  for (let i = 0; i < len; i++) {
    for (let k = 0; k < series.length; k++) {
      const d = series[k][i];
      if (!d) continue;
      const bh = d.count === 0 ? 0 : Math.max(1.5, (d.count / max) * (h - 4));
      const p = periods[k];
      bars.push(
        <rect
          key={`${k}-${i}`}
          className={days?.[p.key] === d.date ? 'current' : ''}
          x={(i * (gw + gap) + k * bw).toFixed(2)}
          y={(h - bh).toFixed(2)}
          width={Math.max(0.5, bw - 0.4).toFixed(2)}
          height={bh.toFixed(2)}
          rx="0.8"
          style={{ fill: p.color }}
        >
          <title>{`${t('stats.periodPrefix', { k: p.key })}${d.date}: ${nf(d.count)}`}</title>
        </rect>,
      );
    }
  }
  return (
    <>
      <div className="bar-label">
        <span>{t('stats.perDayAll')}</span>
        <span>{t('stats.max', { n: nf(max) })}</span>
      </div>
      <svg className="daily dual" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={t('stats.perDayAll')}>
        {bars}
      </svg>
      <div className="axis">
        <span>{t('stats.dayN', { n: 1 })}</span>
        <span>{t('stats.dayN', { n: len })}</span>
      </div>
    </>
  );
}

function LayerCard({ s, current }: { s: LayerStats; current: string | null }) {
  const { t, nf } = useI18n();
  const total = Math.max(1, s.count);
  const pct = (v: number) => `${((v / total) * 100).toFixed(1)}%`;
  return (
    <article className="layer-card" style={{ '--c': s.color } as React.CSSProperties}>
      <header>
        <span className="swatch" />
        <h3>{s.name}</h3>
        <span className="big">{nf(s.count)}</span>
      </header>
      <dl className="kv">
        <div>
          <dt>{t('stats.totalFrp')}</dt>
          <dd>{nf(s.frp.sum)} MW</dd>
        </div>
        <div>
          <dt>{t('stats.meanMedian')}</dt>
          <dd>
            {nf(s.frp.mean, 1)} / {nf(s.frp.median, 1)}
          </dd>
        </div>
        <div>
          <dt>{t('stats.maxFrp')}</dt>
          <dd>{nf(s.frp.max, 1)} MW</dd>
        </div>
        <div>
          <dt>{t('stats.density')}</dt>
          <dd>{nf(s.densityPer1000Km2, 2)} /1000 km²</dd>
        </div>
      </dl>
      {s.count > 0 ? (
        <>
          <div className="bar-label">
            <span>{t('stats.day', { n: nf(s.dayCount) })}</span>
            <span>{t('stats.night', { n: nf(s.nightCount) })}</span>
          </div>
          <div className="split" role="img" aria-label={`${t('stats.day', { n: s.dayCount })}, ${t('stats.night', { n: s.nightCount })}`}>
            <span className="seg day" style={{ width: pct(s.dayCount) }} />
            <span className="seg night" style={{ width: pct(s.nightCount) }} />
          </div>
          <div className="bar-label">
            <span>{t('stats.confidence')}</span>
            <span>{t('stats.confParts', { l: nf(s.confidence.low), n: nf(s.confidence.nominal), h: nf(s.confidence.high) })}</span>
          </div>
          <div className="split" role="img" aria-label={t('stats.confParts', { l: s.confidence.low, n: s.confidence.nominal, h: s.confidence.high })}>
            <span className="seg c-low" style={{ width: pct(s.confidence.low) }} />
            <span className="seg c-nom" style={{ width: pct(s.confidence.nominal) }} />
            <span className="seg c-high" style={{ width: pct(s.confidence.high) }} />
          </div>
          <DailyChart daily={s.daily} current={current} />
        </>
      ) : (
        <p className="muted small">{t('stats.none')}</p>
      )}
      {s.partial && <p className="stats-warn small">{t('stats.partialSmall')}</p>}
    </article>
  );
}

function DailyChart({ daily, current }: { daily: DailyStat[]; current: string | null }) {
  const { t, nf } = useI18n();
  if (daily.length < 2) return null;
  const max = Math.max(1, ...daily.map((d) => d.count));
  const w = 300, h = 54, gap = daily.length > 20 ? 1 : 2;
  const bw = (w - gap * (daily.length - 1)) / daily.length;
  return (
    <>
      <div className="bar-label">
        <span>{t('stats.perDay')}</span>
        <span>{t('stats.max', { n: nf(max) })}</span>
      </div>
      <svg className="daily" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={t('stats.perDay')}>
        {daily.map((d, i) => {
          const bh = d.count === 0 ? 0 : Math.max(1.5, (d.count / max) * (h - 4));
          return (
            <rect
              key={d.date}
              className={current === d.date ? 'current' : ''}
              x={(i * (bw + gap)).toFixed(2)}
              y={(h - bh).toFixed(2)}
              width={bw.toFixed(2)}
              height={bh.toFixed(2)}
              rx="1"
            >
              <title>{`${d.date}: ${nf(d.count)}, ${nf(d.frpSum)} MW`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="axis">
        <span>{daily[0].date.slice(5)}</span>
        <span>{daily[daily.length - 1].date.slice(5)}</span>
      </div>
    </>
  );
}
