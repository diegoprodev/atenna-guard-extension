interface Props {
  status: string;
  label?: string;
}

const MAP: Record<string, { variant: string; dot: boolean }> = {
  ok: { variant: 'ok', dot: true },
  running: { variant: 'ok', dot: true },
  online: { variant: 'ok', dot: true },
  degraded: { variant: 'degraded', dot: true },
  warning: { variant: 'degraded', dot: true },
  error: { variant: 'error', dot: true },
  down: { variant: 'error', dot: true },
  unknown: { variant: 'neutral', dot: false },
  free: { variant: 'neutral', dot: false },
  pro: { variant: 'ok', dot: false },
  enterprise: { variant: 'ok', dot: false },
};

export function StatusBadge({ status, label }: Props) {
  const key = status?.toLowerCase() ?? 'unknown';
  const cfg = MAP[key] ?? { variant: 'neutral', dot: false };
  return (
    <span className={`status-badge status-badge--${cfg.variant}`}>
      {cfg.dot && <span className="status-dot" />}
      {label ?? status}
    </span>
  );
}
