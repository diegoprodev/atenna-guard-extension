import { useEffect, useState } from 'react';
import { api, CostSummary } from '../api/admin';
import { MetricCard } from '../components/MetricCard';

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function Costs({ token }: { token: string }) {
  const [data, setData] = useState<CostSummary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.costs(token).then(setData).catch(e => setError(e.message));
  }, [token]);

  if (error) return <div className="admin-empty"><div className="admin-empty__title">Erro</div><div className="admin-empty__sub">{error}</div></div>;
  if (!data) return <div className="admin-empty"><div className="admin-empty__sub">Carregando...</div></div>;

  const cf = data.cloudflare;
  const hasCfData = cf && !cf.error && cf.totals;
  const totalUsd = hasCfData
    ? cf.totals!.cost_usd
    : data.cost_breakdown.gemini_usd + data.cost_breakdown.openai_usd;
  const totalTokens = hasCfData
    ? cf.totals!.tokens_in + cf.totals!.tokens_out
    : data.tokens_estimated_total;

  return (
    <>
      <div className="admin-page-header">
        <h1>Uso e Custos</h1>
        <p>{hasCfData ? 'Dados reais do Cloudflare AI Gateway.' : 'Estimativas baseadas em contadores DLP.'}</p>
      </div>

      <div className="admin-kpi-grid">
        <MetricCard
          label="Custo Total"
          value={`$${totalUsd.toFixed(4)}`}
          sub={hasCfData ? 'real · CF Gateway' : 'estimado · DLP'}
          color={totalUsd > 10 ? 'amber' : 'default'}
        />
        <MetricCard
          label="Tokens Processados"
          value={fmt(totalTokens)}
          sub={hasCfData ? 'in + out · CF Gateway' : 'estimativa DLP'}
        />
        {hasCfData ? (
          <>
            <MetricCard label="Erros" value={String(cf.totals!.requests_errored)} sub="requisições com erro" color={cf.totals!.requests_errored > 0 ? 'amber' : 'default'} />
            <MetricCard label="Cached" value={String(cf.totals!.requests_cached)} sub="requisições em cache" />
          </>
        ) : (
          <>
            <MetricCard label="Gemini (est.)" value={`$${data.cost_breakdown.gemini_usd.toFixed(4)}`} />
            <MetricCard label="OpenAI (est.)" value={`$${data.cost_breakdown.openai_usd.toFixed(4)}`} />
          </>
        )}
      </div>

      {/* CF real data table */}
      {hasCfData && cf.by_provider && Object.keys(cf.by_provider).length > 0 && (
        <div className="admin-card">
          <div className="admin-card__header">
            <span className="admin-card__title">Por provedor · dados reais</span>
            <span className="admin-card__sub" style={{ color: 'var(--green)', fontSize: 12 }}>● Cloudflare AI Gateway</span>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr><th>Provedor</th><th>Modelo</th><th>Tokens In</th><th>Tokens Out</th><th>Custo Real</th></tr>
              </thead>
              <tbody>
                {Object.entries(cf.by_provider).map(([provider, stats]) => (
                  <tr key={provider}>
                    <td style={{ textTransform: 'capitalize' }}>{provider}</td>
                    <td className="mono text-muted">{stats.model}</td>
                    <td className="mono">{fmt(stats.tokens_in)}</td>
                    <td className="mono">{fmt(stats.tokens_out)}</td>
                    <td className="mono" style={{ fontWeight: 600 }}>${stats.cost_usd.toFixed(6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Estimated fallback table (shown when no CF data) */}
      {!hasCfData && (
        <div className="admin-card">
          <div className="admin-card__header">
            <span className="admin-card__title">Estimativa por provedor</span>
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
      )}

      {/* CF status / error banner */}
      <div className="admin-card">
        <div className="admin-card__header">
          <span className="admin-card__title">Cloudflare AI Gateway</span>
          {hasCfData
            ? <span style={{ fontSize: 12, color: 'var(--green)' }}>● Conectado</span>
            : <span style={{ fontSize: 12, color: 'var(--amber)' }}>● Token sem permissão</span>
          }
        </div>
        <div style={{ padding: '14px 20px', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>
          {hasCfData ? (
            <>
              Dados em tempo real. Para cache hit rate e latência p50/p95 detalhados, acesse o{' '}
              <a href="https://dash.cloudflare.com" target="_blank" rel="noopener noreferrer"
                style={{ color: 'var(--blue)', textDecoration: 'underline' }}>
                Cloudflare Dashboard → AI Gateway → atenna-safe-plugin
              </a>.
            </>
          ) : (
            <>
              {cf?.error && <><strong>Erro:</strong> {cf.error}<br /></>}
              Para ativar dados reais, crie um API Token no Cloudflare com permissão{' '}
              <strong>Account → AI Gateway → Read</strong> e atualize{' '}
              <code style={{ background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 3 }}>CF_AIG_TOKEN</code>{' '}
              no arquivo <code style={{ background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 3 }}>.env</code> da VPS.
            </>
          )}
        </div>
      </div>
    </>
  );
}
