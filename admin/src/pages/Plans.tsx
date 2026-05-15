import { useEffect, useState } from 'react';
import { api, PlanUserRow, PlanConfig } from '../api/admin';

const PLAN_COLORS: Record<string, string> = {
  free: '#6b7280', pro: '#6366f1', enterprise: '#f59e0b',
};
const STATUS_COLORS: Record<string, string> = {
  active: '#22c55e', trialing: '#6366f1', past_due: '#ef4444', canceled: '#6b7280',
};
const STATUS_LABELS: Record<string, string> = {
  active: 'Ativo', trialing: 'Trial', past_due: 'Inadimplente', canceled: 'Cancelado',
};

function fmtDate(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function Plans({ token }: { token: string }) {
  const [rows, setRows]     = useState<PlanUserRow[]>([]);
  const [config, setConfig] = useState<Record<string, PlanConfig>>({});
  const [usdBrl, setUsdBrl] = useState(5.80);
  const [loading, setLoading] = useState(false);
  const [search, setSearch]   = useState('');
  const [planFilter, setPlanFilter]     = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);

  // Assign modal
  const [assignModal, setAssignModal] = useState(false);
  const [aUserId, setAUserId]   = useState('');
  const [aPlan, setAPlan]       = useState('pro');
  const [aBilling, setABilling] = useState('monthly');
  const [aStatus, setAStatus]   = useState('active');
  const [aNotes, setANotes]     = useState('');

  function load() {
    setLoading(true);
    Promise.all([
      api.plansUsers(token, planFilter, statusFilter, search),
      api.plansConfig(token),
    ])
      .then(([pr, cfg]) => {
        setRows(pr.data);
        setConfig(cfg.plans);
        setUsdBrl(cfg.usd_brl_rate);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [token, planFilter, statusFilter]);

  function setFb(msg: string, ok: boolean) {
    setFeedback({ msg, ok });
    setTimeout(() => setFeedback(null), 4000);
  }

  async function handleAssign() {
    try {
      await api.assignPlan(token, { user_id: aUserId, plan_type: aPlan, billing_period: aBilling, status: aStatus, notes: aNotes });
      setFb('Plano atribuído com sucesso.', true);
      setAssignModal(false);
      load();
    } catch { setFb('Erro ao atribuir plano.', false); }
  }

  async function handleStatusChange(uid: string, status: string) {
    try {
      await api.updatePlanStatus(token, uid, status);
      setFb(`Status atualizado para ${STATUS_LABELS[status] ?? status}.`, true);
      load();
    } catch { setFb('Erro ao atualizar status.', false); }
  }

  const inp: React.CSSProperties = { width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-1)', fontSize: 13, boxSizing: 'border-box' };

  // Summary by plan
  const summary = Object.keys(config).reduce((acc, plan) => {
    acc[plan] = rows.filter(r => r.plan_type === plan).length;
    return acc;
  }, {} as Record<string, number>);

  const mrr = rows.reduce((sum, r) => {
    if (r.status !== 'active' && r.status !== 'trialing') return sum;
    return sum + (r.billing_period === 'annual' ? r.price_brl / 1 : r.price_brl);
  }, 0);

  return (
    <>
      <div className="admin-page-header">
        <h1>Planos Pro</h1>
        <p>Gerencie planos, ciclos de cobrança e status de pagamento.</p>
      </div>

      {feedback && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 6, fontSize: 13,
          background: feedback.ok ? 'rgba(34,197,94,.12)' : 'rgba(239,68,68,.12)',
          color: feedback.ok ? 'var(--green)' : 'var(--red)',
          border: `1px solid ${feedback.ok ? 'var(--green)' : 'var(--red)'}`,
        }}>{feedback.msg}</div>
      )}

      {/* Plan tier cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        {Object.entries(config).map(([plan, cfg]) => (
          <div key={plan} className="admin-card" style={{ padding: 20, borderTop: `3px solid ${PLAN_COLORS[plan] ?? '#6b7280'}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontWeight: 700, fontSize: 14, textTransform: 'capitalize', color: PLAN_COLORS[plan] }}>{plan}</span>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{summary[plan] ?? 0} usuários</span>
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 2 }}>
              {cfg.price_brl_monthly === 0 ? 'Grátis' : `R$ ${cfg.price_brl_monthly.toFixed(2)}`}
              {cfg.price_brl_monthly > 0 && <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-3)' }}>/mês</span>}
            </div>
            {cfg.price_brl_annual > 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 10 }}>
                ou R$ {(cfg.price_brl_annual / 12).toFixed(2)}/mês anual · economize {Math.round((1 - cfg.price_brl_annual / (cfg.price_brl_monthly * 12)) * 100)}%
              </div>
            )}
            <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 11, color: 'var(--text-2)', lineHeight: 1.8 }}>
              {cfg.features.map(f => <li key={f}>{f}</li>)}
            </ul>
            {cfg.quota_daily > 0 && (
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-3)' }}>
                {cfg.quota_daily} prompts/dia
              </div>
            )}
          </div>
        ))}
      </div>

      {/* MRR summary */}
      <div className="admin-card" style={{ marginBottom: 20 }}>
        <div className="admin-card__header">
          <span className="admin-card__title">Receita Mensal Recorrente</span>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>contas active + trialing</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: 'var(--border)' }}>
          {[
            { label: 'MRR (BRL)', value: `R$ ${mrr.toFixed(2)}` },
            { label: 'MRR (USD)', value: `$${(mrr / usdBrl).toFixed(2)}` },
            { label: 'Pro ativos', value: String(rows.filter(r => r.plan_type === 'pro' && r.status === 'active').length) },
            { label: 'Inadimplentes', value: String(rows.filter(r => r.status === 'past_due').length), alert: rows.some(r => r.status === 'past_due') },
          ].map(item => (
            <div key={item.label} style={{ background: 'var(--surface)', padding: '14px 20px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>{item.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: (item as any).alert ? 'var(--red)' : 'var(--text-1)' }}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Users table */}
      <div className="admin-card">
        <div className="admin-card__header">
          <span className="admin-card__title">{rows.length} contas</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <form onSubmit={e => { e.preventDefault(); load(); }} style={{ display: 'flex', gap: 8 }}>
              <input className="admin-search" placeholder="Buscar email..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: 180 }} />
              <button type="submit" className="btn btn-secondary btn-sm">Buscar</button>
            </form>
            <select value={planFilter} onChange={e => setPlanFilter(e.target.value)}
              style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-1)', fontSize: 12 }}>
              <option value="">Todos os planos</option>
              {Object.keys(config).map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-1)', fontSize: 12 }}>
              <option value="">Todos os status</option>
              {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button className="btn btn-primary btn-sm" onClick={() => setAssignModal(true)}>+ Atribuir plano</button>
          </div>
        </div>

        {loading ? (
          <div className="admin-empty"><div className="admin-empty__sub">Carregando...</div></div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Usuário</th><th>Plano</th><th>Ciclo</th><th>Status</th><th>Valor/mês</th><th>Atualizado</th><th>Alterar status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.user_id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{r.email}</div>
                      <div className="mono text-xs text-muted">{r.user_id.slice(0, 8)}…</div>
                    </td>
                    <td>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                        background: `${PLAN_COLORS[r.plan_type] ?? '#6b7280'}22`, color: PLAN_COLORS[r.plan_type] ?? '#6b7280' }}>
                        {r.plan_type}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-2)' }}>{r.billing_period === 'annual' ? 'Anual' : 'Mensal'}</td>
                    <td>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                        background: `${STATUS_COLORS[r.status] ?? '#6b7280'}22`, color: STATUS_COLORS[r.status] ?? '#6b7280' }}>
                        {STATUS_LABELS[r.status] ?? r.status}
                      </span>
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {r.price_brl === 0 ? '—' : `R$ ${r.price_brl.toFixed(2)}`}
                    </td>
                    <td className="text-muted" style={{ fontSize: 12 }}>{fmtDate(r.updated_at)}</td>
                    <td>
                      <select
                        value={r.status}
                        onChange={e => handleStatusChange(r.user_id, e.target.value)}
                        style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-1)', fontSize: 11 }}
                      >
                        {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Assign modal */}
      {assignModal && (
        <div className="admin-modal-overlay" onClick={() => setAssignModal(false)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <div className="admin-modal__header"><h2>Atribuir plano</h2></div>
            <div className="admin-modal__body">
              <div style={{ marginBottom: 12 }}><label style={{ fontSize: 12, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>User ID *</label>
                <input style={inp} value={aUserId} onChange={e => setAUserId(e.target.value)} placeholder="UUID do usuário" /></div>
              <div style={{ marginBottom: 12 }}><label style={{ fontSize: 12, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>Plano</label>
                <select style={inp} value={aPlan} onChange={e => setAPlan(e.target.value)}>
                  {Object.keys(config).map(p => <option key={p} value={p}>{p}</option>)}
                </select></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div><label style={{ fontSize: 12, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>Ciclo</label>
                  <select style={inp} value={aBilling} onChange={e => setABilling(e.target.value)}>
                    <option value="monthly">Mensal</option><option value="annual">Anual</option>
                  </select></div>
                <div><label style={{ fontSize: 12, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>Status</label>
                  <select style={inp} value={aStatus} onChange={e => setAStatus(e.target.value)}>
                    {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select></div>
              </div>
              <div><label style={{ fontSize: 12, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>Notas</label>
                <input style={inp} value={aNotes} onChange={e => setANotes(e.target.value)} placeholder="Motivo, observações..." /></div>
            </div>
            <div className="admin-modal__footer">
              <button className="btn btn-ghost btn-sm" onClick={() => setAssignModal(false)}>Cancelar</button>
              <button className="btn btn-primary btn-sm" disabled={!aUserId} onClick={handleAssign}>Salvar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
