export default function MetricCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="ld-metric-card">
      <div className="ld-metric-value">
        {new Intl.NumberFormat("es-DO").format(value)}
      </div>
      <div className="ld-metric-label">{label}</div>
    </div>
  );
}
