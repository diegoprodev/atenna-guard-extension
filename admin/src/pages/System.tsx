import { useEffect, useState } from 'react';
import { api, SystemInfo } from '../api/admin';
import { MetricCard } from '../components/MetricCard';
import { StatusBadge } from '../components/StatusBadge';

function fmtUptime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m`;
}

export function System({ token }: { token: string }) {
  const [data, setData] = useState<SystemInfo | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.system(token)
      .then(setData)
      .catch(e => setError(e.message));
  }, [token]);

  if (error) return <div className="admin-empty"><div className="admin-empty__title">Erro</div><div className="admin-empty__sub">{error}</div></div>;
  if (!data) return <div className="admin-empty"><div className="admin-empty__sub">Carregando...</div></div>;

  const memPct = data.memory.total_mb > 0
    ? Math.round(data.memory.used_mb / data.memory.total_mb * 100)
    : 0;

  return (
    <>
      <div className="admin-page-header">
        <h1>Sistema</h1>
        <p>Estado do backend, recursos e infraestrutura VPS.</p>
      </div>

      <div className="admin-status-strip">
        <StatusBadge status={data.backend_status} label={`Backend: ${data.backend_status}`} />
        <StatusBadge status={data.container_status} label={`Container: ${data.container_status}`} />
      </div>

      <div className="admin-kpi-grid">
        <MetricCard label="Uptime" value={fmtUptime(data.uptime_seconds)} />
        <MetricCard
          label="Latência /health"
          value={data.health_latency_ms !== null ? `${data.health_latency_ms}ms` : '—'}
          color={data.health_latency_ms !== null && data.health_latency_ms > 500 ? 'amber' : 'default'}
        />
        <MetricCard
          label="Memória usada"
          value={`${data.memory.used_mb} MB`}
          sub={`de ${data.memory.total_mb} MB (${memPct}%)`}
          color={memPct > 85 ? 'red' : memPct > 70 ? 'amber' : 'default'}
        />
        <MetricCard
          label="Disco"
          value={`${data.disk.used_pct}%`}
          sub={`de ${data.disk.total_gb} GB`}
          color={data.disk.used_pct > 85 ? 'red' : data.disk.used_pct > 70 ? 'amber' : 'default'}
        />
      </div>

      <div className="admin-card">
        <div className="admin-card__header">
          <span className="admin-card__title">Detalhes de recursos</span>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <tbody>
              <tr><td style={{ fontWeight: 500, width: 200 }}>Memória disponível</td><td>{data.memory.free_mb} MB</td></tr>
              <tr><td style={{ fontWeight: 500 }}>Uptime (segundos)</td><td className="mono">{data.uptime_seconds.toLocaleString()}</td></tr>
              <tr><td style={{ fontWeight: 500 }}>Container</td><td><StatusBadge status={data.container_status} /></td></tr>
              <tr><td style={{ fontWeight: 500 }}>Latência healthcheck</td><td className="mono">{data.health_latency_ms ?? '—'}ms</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
