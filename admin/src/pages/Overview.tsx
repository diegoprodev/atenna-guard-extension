import { useEffect, useState } from 'react';
import { api, AdminOverview } from '../api/admin';
import { MetricCard } from '../components/MetricCard';
import { StatusBadge } from '../components/StatusBadge';

function fmt(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }

export function Overview({ token }: { token: string }) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.overview(token)
      .then(setData)
      .catch(e => setError(e.message));
  }, [token]);

  if (error) return <div className="admin-empty"><div className="admin-empty__title">Erro ao carregar dados</div><div className="admin-empty__sub">{error}</div></div>;
  if (!data) return <div className="admin-empty"><div className="admin-empty__sub">Carregando...</div></div>;

  return (
    <>
      <div className="admin-page-header">
        <h1>Visão Geral</h1>
        <p>Estado atual da plataforma Atenna Safe Prompt.</p>
      </div>

      <div className="admin-status-strip">
        <StatusBadge status={data.status.backend} label={`Backend: ${data.status.backend}`} />
        <StatusBadge status={data.status.supabase} label={`Supabase: ${data.status.supabase}`} />
        <StatusBadge status={data.status.openai} label={`OpenAI: ${data.status.openai}`} />
        <StatusBadge status={data.status.gemini} label={`Gemini: ${data.status.gemini}`} />
      </div>

      <div className="admin-kpi-grid">
        <MetricCard label="Usuários Total" value={fmt(data.users_total)} />
        <MetricCard label="Ativos Hoje" value={fmt(data.users_active_today)} />
        <MetricCard label="Prompts Hoje" value={fmt(data.prompts_today)} />
        <MetricCard label="Uploads Analisados" value={fmt(data.uploads_analyzed)} />
        <MetricCard label="Scans DLP" value={fmt(data.dlp_scans_total)} />
        <MetricCard label="Dados Protegidos" value={fmt(data.dlp_protected_total)} sub="substituições" />
        <MetricCard
          label="Erros 5xx Hoje"
          value={data.errors_5xx_today}
          color={data.errors_5xx_today > 0 ? 'red' : 'default'}
        />
        <MetricCard
          label="Custo Estimado"
          value={`$${data.cost_estimate_usd.toFixed(4)}`}
          sub="via CF Gateway"
        />
      </div>
    </>
  );
}
