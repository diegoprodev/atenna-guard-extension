import { useEffect, useState } from 'react';
import { api, AdminUser, UsersResponse } from '../api/admin';
import { StatusBadge } from '../components/StatusBadge';
import { ConfirmModal } from '../components/ConfirmModal';

function fmtDate(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

type Action = { type: 'block' | 'revoke' | 'quota'; user: AdminUser };

export function Users({ token }: { token: string }) {
  const [resp, setResp] = useState<UsersResponse | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [feedback, setFeedback] = useState('');

  function load(p = page, s = search) {
    setLoading(true);
    api.users(token, p, s)
      .then(setResp)
      .catch(() => setFeedback('Erro ao carregar usuários.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(1, ''); }, [token]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    load(1, search);
  }

  async function executeAction(a: Action) {
    setConfirm(null);
    try {
      if (a.type === 'block') await api.blockUser(token, a.user.id);
      if (a.type === 'revoke') await api.revokeSession(token, a.user.id);
      if (a.type === 'quota') await api.resetQuota(token, a.user.id);
      setFeedback(`Ação "${a.type}" executada. Audit log registrado.`);
      load();
    } catch {
      setFeedback('Erro ao executar ação.');
    }
  }

  const ACTION_LABELS = { block: 'Bloquear usuário', revoke: 'Revogar sessão', quota: 'Resetar quota' };
  const ACTION_BODIES: Record<Action['type'], (u: AdminUser) => string> = {
    block: u => `Bloquear ${u.email}? O usuário perderá acesso imediatamente. Esta ação será registrada no audit log.`,
    revoke: u => `Revogar todas as sessões de ${u.email}? O usuário será desconectado em todos os dispositivos.`,
    quota: u => `Resetar quota de ${u.email}? O contador diário será zerado.`,
  };

  return (
    <>
      <div className="admin-page-header">
        <h1>Usuários</h1>
        <p>Gerencie contas, planos e sessões. Toda ação gera audit log.</p>
      </div>

      {feedback && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: 'var(--blue-bg)', color: 'var(--blue)', borderRadius: 6, fontSize: 13 }}>
          {feedback}
          <button className="btn-ghost btn btn-sm" style={{ float: 'right' }} onClick={() => setFeedback('')}>×</button>
        </div>
      )}

      <div className="admin-card">
        <div className="admin-card__header">
          <span className="admin-card__title">
            {resp ? `${resp.total} usuários` : 'Usuários'}
          </span>
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8 }}>
            <input
              className="admin-search"
              placeholder="Buscar por email..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <button type="submit" className="btn btn-secondary btn-sm">Buscar</button>
          </form>
        </div>

        {loading ? (
          <div className="admin-empty"><div className="admin-empty__sub">Carregando...</div></div>
        ) : !resp?.data.length ? (
          <div className="admin-empty">
            <div className="admin-empty__title">Nenhum usuário encontrado</div>
            <div className="admin-empty__sub">Tente outro termo de busca.</div>
          </div>
        ) : (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Plano</th>
                    <th>Cadastro</th>
                    <th>Último acesso</th>
                    <th>Status</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {resp.data.map(u => (
                    <tr key={u.id}>
                      <td>
                        <span style={{ fontWeight: 500 }}>{u.email}</span>
                        <div className="text-xs text-muted mono">{u.id.slice(0, 8)}…</div>
                      </td>
                      <td><StatusBadge status={u.plan_type ?? 'free'} /></td>
                      <td className="text-muted">{fmtDate(u.created_at)}</td>
                      <td className="text-muted">{fmtDate(u.last_sign_in_at)}</td>
                      <td>
                        <StatusBadge
                          status={u.banned_until ? 'error' : 'ok'}
                          label={u.banned_until ? 'Bloqueado' : 'Ativo'}
                        />
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => setConfirm({ type: 'revoke', user: u })}
                          >
                            Revogar sessão
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => setConfirm({ type: 'quota', user: u })}
                          >
                            Reset quota
                          </button>
                          {!u.banned_until && (
                            <button
                              className="btn btn-ghost btn-sm text-red"
                              onClick={() => setConfirm({ type: 'block', user: u })}
                            >
                              Bloquear
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="admin-pagination">
              <button
                className="btn btn-ghost btn-sm"
                disabled={page <= 1}
                onClick={() => { setPage(p => p - 1); load(page - 1); }}
              >
                ← Anterior
              </button>
              <span>Página {page}</span>
              <button
                className="btn btn-ghost btn-sm"
                disabled={resp.data.length < 25}
                onClick={() => { setPage(p => p + 1); load(page + 1); }}
              >
                Próxima →
              </button>
            </div>
          </>
        )}
      </div>

      {confirm && (
        <ConfirmModal
          title={ACTION_LABELS[confirm.type]}
          body={ACTION_BODIES[confirm.type](confirm.user)}
          confirmLabel={ACTION_LABELS[confirm.type]}
          danger={confirm.type === 'block'}
          onConfirm={() => executeAction(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}
