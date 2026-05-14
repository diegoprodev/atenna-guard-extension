import { useEffect, useState } from 'react';
import { api, ErrorEvent } from '../api/admin';
import { StatusBadge } from '../components/StatusBadge';

function sevToStatus(s: string) {
  if (s === 'critical' || s === 'high') return 'error';
  if (s === 'medium') return 'degraded';
  return 'neutral';
}

function fmtDt(s: string) {
  return new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
}

export function Errors({ token }: { token: string }) {
  const [data, setData] = useState<ErrorEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  function load(p = page) {
    setLoading(true);
    api.errors(token, p)
      .then(r => { setData(r.data); setTotal(r.total); })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(1); }, [token]);

  return (
    <>
      <div className="admin-page-header">
        <h1>Erros</h1>
        <p>Eventos de erro sanitizados. Nenhum payload bruto ou dado sensível é exibido.</p>
      </div>

      <div className="admin-card">
        <div className="admin-card__header">
          <span className="admin-card__title">{total} erros registrados</span>
        </div>

        {loading ? (
          <div className="admin-empty"><div className="admin-empty__sub">Carregando...</div></div>
        ) : data.length === 0 ? (
          <div className="admin-empty">
            <div className="admin-empty__title">Nenhum erro registrado</div>
            <div className="admin-empty__sub">Sistema operando sem erros recentes.</div>
          </div>
        ) : (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Status</th>
                    <th>Endpoint</th>
                    <th>Tipo</th>
                    <th>Mensagem</th>
                    <th>Severidade</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map(e => (
                    <tr key={e.id}>
                      <td className="mono text-muted text-xs">{fmtDt(e.created_at)}</td>
                      <td>
                        <span className={`mono text-xs ${e.status_code >= 500 ? 'text-red' : 'text-amber'}`}>
                          {e.status_code}
                        </span>
                      </td>
                      <td className="mono text-xs">{e.method} {e.endpoint}</td>
                      <td className="text-xs text-muted">{e.error_type ?? '—'}</td>
                      <td style={{ maxWidth: 280, fontSize: 12 }}>{e.error_message ?? '—'}</td>
                      <td><StatusBadge status={sevToStatus(e.severity)} label={e.severity} /></td>
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
