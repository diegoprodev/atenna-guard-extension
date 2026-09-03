import { useEffect, useState } from 'react';
import { api, FeedbackRow, FeedbackSummary } from '../api/admin';

const REASON_LABEL: Record<string, string> = {
  nao_melhorou: 'Não melhorou os prompts',
  confuso: 'Difícil / confuso',
  bugs: 'Bugs ou lentidão',
  faltou_recurso: 'Faltou um recurso',
  caro: 'Muito caro / alternativa grátis',
  nao_preciso: 'Não precisa mais',
  outro: 'Outro',
};

function fmtDt(s: string) {
  return new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function Feedback({ token }: { token: string }) {
  const [data, setData] = useState<FeedbackRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [loading, setLoading] = useState(true);

  function load(p = page) {
    setLoading(true);
    api.feedback(token, p)
      .then(r => { setData(r.data); setTotal(r.total); })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load(1);
    api.feedbackSummary(token).then(setSummary).catch(() => setSummary(null));
  }, [token]);

  return (
    <>
      <div className="admin-page-header">
        <h1>Feedback de desinstalação</h1>
        <p>Respostas do formulário mostrado quando o usuário remove a extensão.</p>
      </div>

      {summary && summary.total > 0 && (
        <div className="admin-card" style={{ marginBottom: 16 }}>
          <div className="admin-card__header">
            <span className="admin-card__title">{summary.total} respostas · motivos</span>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <tbody>
                {Object.entries(summary.by_reason).map(([k, n]) => (
                  <tr key={k}>
                    <td>{REASON_LABEL[k] ?? k}</td>
                    <td className="mono text-xs" style={{ textAlign: 'right' }}>{n}</td>
                    <td style={{ width: '50%' }}>
                      <div style={{ background: 'var(--accent, #0B6E4B)', height: 6, borderRadius: 3, width: `${(n / summary.total) * 100}%` }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="admin-card">
        <div className="admin-card__header">
          <span className="admin-card__title">{total} respostas</span>
        </div>

        {loading ? (
          <div className="admin-empty"><div className="admin-empty__sub">Carregando...</div></div>
        ) : data.length === 0 ? (
          <div className="admin-empty">
            <div className="admin-empty__title">Nenhuma resposta ainda</div>
            <div className="admin-empty__sub">Aparecem aqui quando alguém desinstala e responde o formulário.</div>
          </div>
        ) : (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Motivo</th>
                    <th>O que faltou</th>
                    <th>Email</th>
                    <th>Versão</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map(r => (
                    <tr key={r.id}>
                      <td className="mono text-muted text-xs">{fmtDt(r.created_at)}</td>
                      <td className="text-xs">{REASON_LABEL[r.reason] ?? r.reason}</td>
                      <td style={{ maxWidth: 320, fontSize: 12 }}>{r.detail ?? '—'}</td>
                      <td className="mono text-xs text-muted">{r.email ?? '—'}</td>
                      <td className="mono text-xs text-muted">{r.ext_version ?? '—'}</td>
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
