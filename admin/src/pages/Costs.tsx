import { useEffect, useState } from 'react';
import { api, CostSummary } from '../api/admin';
import { MetricCard } from '../components/MetricCard';

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

type Currency = 'USD' | 'BRL';

export function Costs({ token }: { token: string }) {
  const [data, setData] = useState<CostSummary | null>(null);
  const [error, setError] = useState('');
  const [currency, setCurrency] = useState<Currency>(() => {
    try { return (localStorage.getItem('atenna_admin_currency') as Currency) || 'USD'; }
    catch { return 'USD'; }
  });

  function setCur(c: Currency) {
    setCurrency(c);
    try { localStorage.setItem('atenna_admin_currency', c); } catch { /* */ }
  }

  useEffect(() => {
    api.costs(token).then(setData).catch(e => setError(e.message));
  }, [token]);

  // Conversão USD→BRL ao vivo (câmbio real vem do backend, frankfurter.app/ECB).
  const rate = data?.usd_brl_rate ?? 1;
  const money = (usd: number, digits = 4) =>
    currency === 'BRL'
      ? `R$ ${(usd * rate).toFixed(digits === 6 ? 4 : 2).replace('.', ',')}`
      : `$${usd.toFixed(digits)}`;

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
      <div className="admin-page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h1>Uso e Custos</h1>
          <p>{hasCfData ? 'Dados reais do Cloudflare AI Gateway.' : 'Estimativas baseadas em contadores DLP.'}</p>
        </div>
        {/* Toggle de moeda — 1 clique, câmbio real ao vivo */}
        <div role="group" aria-label="Moeda" style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
          {(['USD', 'BRL'] as Currency[]).map(c => (
            <button
              key={c}
              onClick={() => setCur(c)}
              aria-pressed={currency === c}
              style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                background: currency === c ? 'var(--blue)' : 'var(--surface)',
                color: currency === c ? '#fff' : 'var(--text-2)',
              }}
            >
              {c === 'USD' ? '$ USD' : 'R$ BRL'}
            </button>
          ))}
        </div>
      </div>

      {currency === 'BRL' && (
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>
          Câmbio ao vivo: 1 USD = R$ {rate.toFixed(2).replace('.', ',')} (fonte: ECB/frankfurter.app)
        </p>
      )}

      <div className="admin-kpi-grid">
        <MetricCard
          label="Custo Total"
          value={money(totalUsd, 4)}
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
            <MetricCard label="Gemini (est.)" value={money(data.cost_breakdown.gemini_usd, 4)} />
            <MetricCard label="OpenAI (est.)" value={money(data.cost_breakdown.openai_usd, 4)} />
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
                <tr><th>Provedor</th><th>Modelo</th><th>Tokens In</th><th>Tokens Out</th><th>Custo Real ({currency === 'BRL' ? 'R$' : '$'})</th></tr>
              </thead>
              <tbody>
                {Object.entries(cf.by_provider).map(([provider, stats]) => (
                  <tr key={provider}>
                    <td style={{ textTransform: 'capitalize' }}>{provider}</td>
                    <td className="mono text-muted">{stats.model}</td>
                    <td className="mono">{fmt(stats.tokens_in)}</td>
                    <td className="mono">{fmt(stats.tokens_out)}</td>
                    <td className="mono" style={{ fontWeight: 600 }}>{money(stats.cost_usd, 6)}</td>
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
                <tr><th>Provedor</th><th>Modelo</th><th>Preço / 1k tokens (in)</th><th>Custo estimado ({currency === 'BRL' ? 'R$' : '$'})</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>Gemini</td>
                  <td className="mono text-muted">gemini-2.5-flash-lite</td>
                  <td className="mono">$0.00010</td>
                  <td className="mono" style={{ fontWeight: 600 }}>{money(data.cost_breakdown.gemini_usd, 4)}</td>
                </tr>
                <tr>
                  <td>OpenAI</td>
                  <td className="mono text-muted">gpt-4.1-nano</td>
                  <td className="mono">$0.00010</td>
                  <td className="mono" style={{ fontWeight: 600 }}>{money(data.cost_breakdown.openai_usd, 4)}</td>
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
