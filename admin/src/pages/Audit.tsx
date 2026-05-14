import { useEffect, useState } from 'react';
import { api, AuditEvent } from '../api/admin';

function fmtDt(s: string) {
  return new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
}

const ACTION_COLOR: Record<string, string> = {
  'user.block': 'text-red',
  'user.revoke_session': 'text-amber',
  'user.reset_quota': 'text-amber',
  'user.plan_change': 'text-blue',
};

export function Audit({ token }: { token: string }) {
  const [data, setData] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const [loading, setLoading] = useState(true);

  function load(p = page) {
    setLoading(true);
    api.audit(token, p)
      .then(r => { setData(r.data); setTotal(r.total); })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(1); }, [token]);

  return (
    <>
      <div className="admin-page-header">
        <h1>Auditoria</h1>
        <p>Registro imutável de todas as ações administrativas.</p>
      </div>

      <div className="admin-card">
        <div className="admin-card__header">
          <span className="admin-card__title">{total} eventos</span>
          <form onSubmit={e => { e.preventDefault(); setPage(1); load(1); }} style={{ display: 'flex', gap: 8 }}>
            <input
              className="admin-search"
              placeholder="Filtrar por ação..."
              value={actionFilter}
              onChange={e => setActionFilter(e.target.value)}
              style={{ width: 200 }}
            />
            <button type="submit" className="btn btn-secondary btn-sm">Filtrar</button>
          </form>
        </div>

        {loading ? (
          <div className="admin-empty"><div className="admin-empty__sub">Carregando...</div></div>
        ) : data.length === 0 ? (
          <div className="admin-empty">
            <div className="admin-empty__title">Nenhum evento encontrado</div>
            <div className="admin-empty__sub">Ações administrativas aparecerão aqui.</div>
          </div>
        ) : (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Ator</th>
                    <th>Ação</th>
                    <th>Alvo</th>
                    <th>Detalhes</th>
                    <th>Correlation ID</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map(e => (
                    <tr key={e.id}>
                      <td className="mono text-xs text-muted">{fmtDt(e.created_at)}</td>
                      <td className="mono text-xs">{e.actor_id.slice(0, 8)}…</td>
                      <td>
                        <span className={`mono text-xs ${ACTION_COLOR[e.action] ?? ''}`} style={{ fontWeight: 600 }}>
                          {e.action}
                        </span>
                      </td>
                      <td className="mono text-xs text-muted">{e.target_id ? e.target_id.slice(0, 8) + '…' : '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-2)' }}>
                        {e.after ? JSON.stringify(e.after).slice(0, 60) : '—'}
                      </td>
                      <td className="mono text-xs text-muted">{e.correlation_id ? e.correlation_id.slice(0, 8) + '…' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="admin-pagination">
              <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => { setPage(p => p - 1); load(page - 1); }}>← Anterior</button>
              <span>Página {page} · {total} total</span>
              <button className="btn btn-ghost btn-sm" disabled={data.length < 50} onClick={() => { setPage(p => p + 1); load(page + 1); }}>Próxima →</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
