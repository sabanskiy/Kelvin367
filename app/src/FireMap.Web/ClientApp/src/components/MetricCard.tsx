// Figma key-number card.
export function MetricCard({
  label,
  value,
  detail,
  tone = '',
  title,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: '' | 'hot' | 'warm' | 'cool' | 'good';
  title?: string;
}) {
  return (
    <article className="metric-card" title={title}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {detail && <div className={`metric-detail ${tone}`}>{detail}</div>}
    </article>
  );
}
