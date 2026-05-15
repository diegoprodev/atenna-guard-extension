import { useEffect, useState } from 'react';
import { api, UsageRow, UsageResponse } from '../api/admin';

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
function fmtBRL(v: number) {
  if (v === 0) return 'R$ 0,00';
  if (v < 0.01) return '< R$ 0,01';
  return `R$ ${v.toFixed(2).replace('.', ',')}`;
}
function fmtUSD(v: number) {
  if (v === 0) return '$0.000000';
  return `$${v.toFixed(6)}`;
}

const SORTS = [
  { value: 'cost_desc',   label: 'Custo ↓' },
  { value: 'scans_desc',  label: 'Scans ↓' },
  { value: 'tokens_desc', label: 'Tokens ↓' },
  { value: 'email_asc',   label: 'Email A→Z' },
];

const PLAN_COLORS: Record<string, string> = {
  free: '#6b7280', pro: '#6366f1', enterprise: '#f59e0b',
};

export function UsageCosts({ token }: { token: string }) {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('cost_desc');
  const [loading, setLoading] = useState(false);

  function load() {
    setLoading(true);
    api.usage(token, search, sort)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [token, sort]);

  const maxCost = data ? Math.max(...data.data.map(r => r.cost_usd), 0.000001) : 1;
  const maxScans = data ? Math.max(...data.data.map(r => r.scans_total), 1) : 1;

  return (
    <>
      <div className="admin-page-header">
        <h1>Uso e Custo por Usuário</h1>
        <p>Tokens consumidos e custo real estimado por conta · dados CF Gateway + DLP.</p>
      </div>

      {/* Summary KPIs */}
      {data && (
        <div className="admin-kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
          {[
            { label: 'Usuários', value: String(data.total_users) },
            { label: 'Tokens Total', value: fmt(data.total_tokens) },
            { label: 'Custo USD', value: `$${data.total_cost_usd.toFixed(6)}` },
            { label: 'Custo BRL', value: fmtBRL(data.total_cost_brl), sub: `1 USD = R$ ${data.usd_brl_rate.toFixed(2).replace('.', ',')}` },
          ].map(k => (
            <div key={k.label} className="admin-kpi-card">
              <div className="admin-kpi-card__label">{k.label}</div>
              <div className="admin-kpi-card__value">{k.value}</div>
              {k.sub && <div className="admin-kpi-card__sub">{k.sub}</div>}
            </div>
          ))}
        </div>
      )}

      <div className="admin-card">
        <div className="admin-card__header">
          <span className="admin-card__title">{data ? `${data.total_users} usuários` : '—'}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <form onSubmit={e => { e.preventDefault(); load(); }} style={{ display: 'flex', gap: 8 }}>
              <input className="admin-search" placeholder="Buscar por email..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: 200 }} />
              <button type="submit" className="btn btn-secondary btn-sm">Buscar</button>
            </form>
            <select
              value={sort} onChange={e => setSort(e.target.value)}
              style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-1)', fontSize: 12 }}
            >
              {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="admin-empty"><div className="admin-empty__sub">Carregando...</div></div>
        ) : !data?.data.length ? (
          <div className="admin-empty"><div className="admin-empty__title">Nenhum dado encontrado</div></div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>Plano</th>
                  <th>Scans DLP</th>
                  <th style={{ width: 120 }}>Tokens CF</th>
                  <th>Custo USD</th>
                  <th>Custo BRL</th>
                  <th style={{ width: 180 }}>Distribuição custo</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((row: UsageRow) => (
                  <tr key={row.user_id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{row.email}</div>
                      <div className="mono text-xs text-muted">{row.user_id.slice(0, 8)}…</div>
                    </td>
                    <td>
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                        background: `${PLAN_COLORS[row.plan] ?? '#6b7280'}22`,
                        color: PLAN_COLORS[row.plan] ?? '#6b7280',
                      }}>
                        {row.plan}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                          height: 4, borderRadius: 2, background: '#6366f133',
                          width: 60, position: 'relative', overflow: 'hidden',
                        }}>
                          <div style={{
                            height: '100%', background: '#6366f1', borderRadius: 2,
                            width: `${Math.min((row.scans_total / maxScans) * 100, 100)}%`,
                          }} />
                        </div>
                        <span className="mono" style={{ fontSize: 12 }}>{fmt(row.scans_total)}</span>
                      </div>
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>{fmt(row.tokens_cf || row.tokens_dlp)}</td>
                    <td className="mono" style={{ fontSize: 12, fontWeight: 600 }}>
                      {fmtUSD(row.cost_usd)}
                    </td>
                    <td className="mono" style={{ fontSize: 12, fontWeight: 600 }}>
                      {fmtBRL(row.cost_brl)}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{
                            height: '100%', borderRadius: 3,
                            width: `${Math.min((row.cost_usd / maxCost) * 100, 100)}%`,
                            background: row.cost_usd > maxCost * 0.7 ? '#ef4444'
                              : row.cost_usd > maxCost * 0.3 ? '#f59e0b'
                              : '#22c55e',
                          }} />
                        </div>
                        <span style={{ fontSize: 10, color: 'var(--text-3)', width: 32, textAlign: 'right' }}>
                          {maxCost > 0 ? `${Math.round((row.cost_usd / maxCost) * 100)}%` : '0%'}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
