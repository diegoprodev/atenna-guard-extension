import { useEffect, useState } from 'react';
import { api, AdminUser, UsersResponse } from '../api/admin';
import { StatusBadge } from '../components/StatusBadge';
import { ConfirmModal } from '../components/ConfirmModal';

function fmtDate(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

type ActionType = 'block' | 'revoke' | 'quota' | 'delete' | 'send_link';
type ModalType = ActionType | 'create' | 'edit' | null;

interface State {
  modal: ModalType;
  target: AdminUser | null;
}

const PLANS = ['free', 'pro', 'enterprise'];
const ROLES = ['', 'super_admin'];

export function Users({ token }: { token: string }) {
  const [resp, setResp] = useState<UsersResponse | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);
  const [state, setState] = useState<State>({ modal: null, target: null });

  // Create form
  const [newEmail, setNewEmail] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newRole, setNewRole] = useState('');
  const [newPlan, setNewPlan] = useState('free');
  const [newInvite, setNewInvite] = useState(false);

  // Edit form
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editPlan, setEditPlan] = useState('free');

  function load(p = page, s = search) {
    setLoading(true);
    api.users(token, p, s)
      .then(setResp)
      .catch(() => setFb('Erro ao carregar usuários.', false))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(1, ''); }, [token]);

  function setFb(msg: string, ok: boolean) {
    setFeedback({ msg, ok });
    setTimeout(() => setFeedback(null), 4000);
  }

  function openEdit(u: AdminUser) {
    setEditEmail(u.email ?? '');
    setEditRole(u.role ?? '');
    setEditPlan(u.plan_type ?? 'free');
    setState({ modal: 'edit', target: u });
  }

  function openCreate() {
    setNewEmail(''); setNewPass(''); setNewRole(''); setNewPlan('free'); setNewInvite(false);
    setState({ modal: 'create', target: null });
  }

  function close() { setState({ modal: null, target: null }); }

  async function handleCreate() {
    try {
      await api.createUser(token, { email: newEmail, password: newPass || undefined, role: newRole || undefined, plan_type: newPlan, send_invite: newInvite });
      setFb('Usuário criado com sucesso.', true);
      close(); load();
    } catch { setFb('Erro ao criar usuário.', false); }
  }

  async function handleEdit() {
    if (!state.target) return;
    try {
      await api.editUser(token, state.target.id, { email: editEmail, role: editRole, plan_type: editPlan });
      setFb('Usuário atualizado.', true);
      close(); load();
    } catch { setFb('Erro ao editar usuário.', false); }
  }

  async function handleSendLink(u: AdminUser) {
    try {
      await api.sendLink(token, u.id);
      setFb(`Link de recuperação enviado para ${u.email}.`, true);
    } catch { setFb('Erro ao enviar link.', false); }
  }

  async function handleBlock(u: AdminUser) {
    try {
      await api.blockUser(token, u.id);
      setFb(`${u.email} bloqueado.`, true);
      load();
    } catch { setFb('Erro ao bloquear.', false); }
  }

  async function handleDelete(u: AdminUser) {
    try {
      await api.deleteUser(token, u.id);
      setFb(`${u.email} excluído.`, true);
      close(); load();
    } catch { setFb('Erro ao excluir usuário.', false); }
  }

  async function handleRevoke(u: AdminUser) {
    try {
      await api.revokeSession(token, u.id);
      setFb(`Sessões de ${u.email} revogadas.`, true);
    } catch { setFb('Erro ao revogar sessão.', false); }
  }

  const inp: React.CSSProperties = {
    width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)',
    background: 'var(--surface)', color: 'var(--text-1)', fontSize: 13, boxSizing: 'border-box',
  };
  const label: React.CSSProperties = { fontSize: 12, color: 'var(--text-2)', marginBottom: 4, display: 'block' };
  const field: React.CSSProperties = { marginBottom: 12 };

  return (
    <>
      <div className="admin-page-header">
        <h1>Usuários</h1>
        <p>Gerencie contas, planos e sessões. Toda ação gera audit log.</p>
      </div>

      {feedback && (
        <div style={{
          marginBottom: 16, padding: '10px 14px', borderRadius: 6, fontSize: 13,
          background: feedback.ok ? 'var(--green-bg, rgba(34,197,94,.12))' : 'var(--red-bg, rgba(239,68,68,.12))',
          color: feedback.ok ? 'var(--green)' : 'var(--red)',
          border: `1px solid ${feedback.ok ? 'var(--green)' : 'var(--red)'}`,
        }}>
          {feedback.msg}
        </div>
      )}

      <div className="admin-card">
        <div className="admin-card__header">
          <span className="admin-card__title">{resp ? `${resp.total} usuários` : 'Usuários'}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <form onSubmit={e => { e.preventDefault(); setPage(1); load(1, search); }} style={{ display: 'flex', gap: 8 }}>
              <input className="admin-search" placeholder="Buscar por email..." value={search} onChange={e => setSearch(e.target.value)} />
              <button type="submit" className="btn btn-secondary btn-sm">Buscar</button>
            </form>
            <button className="btn btn-primary btn-sm" onClick={openCreate}>+ Criar usuário</button>
          </div>
        </div>

        {loading ? (
          <div className="admin-empty"><div className="admin-empty__sub">Carregando...</div></div>
        ) : !resp?.data.length ? (
          <div className="admin-empty">
            <div className="admin-empty__title">Nenhum usuário encontrado</div>
            <div className="admin-empty__sub">Tente outro termo de busca ou crie um novo usuário.</div>
          </div>
        ) : (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Email</th><th>Plano</th><th>Cadastro</th><th>Último acesso</th><th>Status</th><th>Ações</th>
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
                        <StatusBadge status={u.banned_until ? 'error' : 'ok'} label={u.banned_until ? 'Bloqueado' : 'Ativo'} />
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => openEdit(u)}>Editar</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => handleSendLink(u)}>Enviar link</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => handleRevoke(u)}>Revogar sessão</button>
                          {!u.banned_until && (
                            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--amber)' }} onClick={() => setState({ modal: 'block', target: u })}>Bloquear</button>
                          )}
                          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => setState({ modal: 'delete', target: u })}>Excluir</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="admin-pagination">
              <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => { setPage(p => p - 1); load(page - 1); }}>← Anterior</button>
              <span>Página {page}</span>
              <button className="btn btn-ghost btn-sm" disabled={resp.data.length < 25} onClick={() => { setPage(p => p + 1); load(page + 1); }}>Próxima →</button>
            </div>
          </>
        )}
      </div>

      {/* ── Create modal ── */}
      {state.modal === 'create' && (
        <div className="admin-modal-overlay" onClick={close}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <div className="admin-modal__header"><h2>Criar usuário</h2></div>
            <div className="admin-modal__body">
              <div style={field}><label style={label}>Email *</label><input style={inp} type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="email@exemplo.com" /></div>
              <div style={field}><label style={label}>Senha (deixe vazio para enviar convite)</label><input style={inp} type="password" value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="Mín. 12 chars, maiúscula, especial" /></div>
              <div style={field}><label style={label}>Plano</label>
                <select style={inp} value={newPlan} onChange={e => setNewPlan(e.target.value)}>
                  {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div style={field}><label style={label}>Role</label>
                <select style={inp} value={newRole} onChange={e => setNewRole(e.target.value)}>
                  <option value="">user</option>
                  <option value="super_admin">super_admin</option>
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <input type="checkbox" id="invite" checked={newInvite} onChange={e => setNewInvite(e.target.checked)} />
                <label htmlFor="invite" style={{ fontSize: 13, color: 'var(--text-2)', cursor: 'pointer' }}>Enviar email de ativação</label>
              </div>
            </div>
            <div className="admin-modal__footer">
              <button className="btn btn-ghost btn-sm" onClick={close}>Cancelar</button>
              <button className="btn btn-primary btn-sm" disabled={!newEmail} onClick={handleCreate}>Criar usuário</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit modal ── */}
      {state.modal === 'edit' && state.target && (
        <div className="admin-modal-overlay" onClick={close}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <div className="admin-modal__header"><h2>Editar usuário</h2><span className="text-xs text-muted mono">{state.target.id.slice(0, 8)}…</span></div>
            <div className="admin-modal__body">
              <div style={field}><label style={label}>Email</label><input style={inp} type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} /></div>
              <div style={field}><label style={label}>Plano</label>
                <select style={inp} value={editPlan} onChange={e => setEditPlan(e.target.value)}>
                  {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div style={field}><label style={label}>Role</label>
                <select style={inp} value={editRole} onChange={e => setEditRole(e.target.value)}>
                  {ROLES.map(r => <option key={r} value={r}>{r || 'user'}</option>)}
                </select>
              </div>
            </div>
            <div className="admin-modal__footer">
              <button className="btn btn-ghost btn-sm" onClick={close}>Cancelar</button>
              <button className="btn btn-primary btn-sm" onClick={handleEdit}>Salvar alterações</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Block confirm ── */}
      {state.modal === 'block' && state.target && (
        <ConfirmModal
          title="Bloquear usuário"
          body={`Bloquear ${state.target.email}? O usuário perderá acesso imediatamente.`}
          confirmLabel="Bloquear"
          danger
          onConfirm={() => { handleBlock(state.target!); close(); }}
          onCancel={close}
        />
      )}

      {/* ── Delete confirm ── */}
      {state.modal === 'delete' && state.target && (
        <ConfirmModal
          title="Excluir usuário"
          body={`Excluir permanentemente ${state.target.email}? Esta ação não pode ser desfeita.`}
          confirmLabel="Excluir permanentemente"
          danger
          onConfirm={() => handleDelete(state.target!)}
          onCancel={close}
        />
      )}
    </>
  );
}
