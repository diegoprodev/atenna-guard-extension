interface Props {
  label: string;
  value: string | number;
  sub?: string;
  color?: 'default' | 'green' | 'red' | 'amber';
}

const COLOR_MAP = {
  default: undefined,
  green: 'text-green',
  red: 'text-red',
  amber: 'text-amber',
};

export function MetricCard({ label, value, sub, color = 'default' }: Props) {
  return (
    <div className="admin-metric-card">
      <div className="admin-metric-card__label">{label}</div>
      <div className={`admin-metric-card__value${color !== 'default' ? ` ${COLOR_MAP[color]}` : ''}`}>
        {value}
      </div>
      {sub && <div className="admin-metric-card__sub">{sub}</div>}
    </div>
  );
}
