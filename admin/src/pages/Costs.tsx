import { useEffect, useState } from 'react';
import { api, CostSummary } from '../api/admin';
import { MetricCard } from '../components/MetricCard';

export function Costs({ token }: { token: string }) {
  const [data, setData] = useState<CostSummary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.costs(token).then(setData).catch(e => setError(e.message));
  }, [token]);

  if (error) return <div className="admin-empty"><div className="admin-empty__title">Erro</div><div className="admin-empty__sub">{error}</div></div>;
  if (!data) return <div className="admin-empty"><div className="admin-empty__sub">Carregando...</div></div>;

  const totalUsd = (data.cost_breakdown.gemini_usd + data.cost_breakdown.openai_usd);

  return (
    <>
      <div className="admin-page-header">
        <h1>Uso e Custos</h1>
        <p>Estimativas baseadas em contadores DLP. Custos reais detalhados no Cloudflare AI Gateway.</p>
      </div>

      <div className="admin-kpi-grid">
        <MetricCard
          label="Custo Total Estimado"
          value={`$${totalUsd.toFixed(4)}`}
          sub="USD acumulado"
          color={totalUsd > 10 ? 'amber' : 'default'}
        />
        <MetricCard
          label="Tokens Processados"
          value={data.tokens_estimated_total >= 1000
            ? `${(data.tokens_estimated_total / 1000).toFixed(1)}k`
            : String(data.tokens_estimated_total)}
          sub="estimativa DLP"
        />
        <MetricCard label="Gemini (estimado)" value={`$${data.cost_breakdown.gemini_usd.toFixed(4)}`} />
        <MetricCard label="OpenAI (estimado)" value={`$${data.cost_breakdown.openai_usd.toFixed(4)}`} />
      </div>

      <div className="admin-card">
        <div className="admin-card__header">
          <span className="admin-card__title">Custos por provedor</span>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>Provedor</th><th>Modelo</th><th>Preço / 1k tokens</th><th>Custo estimado</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>Gemini</td>
                <td className="mono text-muted">gemini-2.5-flash-lite</td>
                <td className="mono">$0.00015</td>
                <td className="mono" style={{ fontWeight: 600 }}>${data.cost_breakdown.gemini_usd.toFixed(4)}</td>
              </tr>
              <tr>
                <td>OpenAI</td>
                <td className="mono text-muted">gpt-4o-mini</td>
                <td className="mono">$0.00200</td>
                <td className="mono" style={{ fontWeight: 600 }}>${data.cost_breakdown.openai_usd.toFixed(4)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ padding: '12px 20px', fontSize: 12, color: 'var(--text-3)', borderTop: '1px solid var(--border)' }}>
          {data.note}
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card__header">
          <span className="admin-card__title">Cloudflare AI Gateway</span>
          <span className="admin-card__sub">Dados em tempo real disponíveis no dashboard CF</span>
        </div>
        <div style={{ padding: '14px 20px', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>
          Para ver cache hit rate, latência p50/p95 e custo real por request,
          acesse o{' '}
          <a
            href="https://dash.cloudflare.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--blue)', textDecoration: 'underline' }}
          >
            Cloudflare Dashboard → AI Gateway → atenna-safe-plugin
          </a>.
        </div>
      </div>
    </>
  );
}
