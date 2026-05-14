import { useEffect, useState } from 'react';
import { api, FlagRow } from '../api/admin';
import { ConfirmModal } from '../components/ConfirmModal';

const FLAG_DESCRIPTIONS: Record<string, string> = {
  MULTIMODAL_ENABLED: 'Exibe widget de upload de documentos na extensão.',
  DOCUMENT_DLP_ENABLED: 'Executa scan DLP em documentos (requer MULTIMODAL_ENABLED).',
  STRICT_DOCUMENT_MODE: 'Documentos de alto risco devem ser protegidos antes do envio.',
  DOCUMENT_UPLOAD_ENABLED: 'Habilita endpoint /document/upload no backend.',
  STRICT_DLP_MODE: 'Força proteção em risco HIGH — sem override pelo usuário.',
};

interface Pending { flag: FlagRow; next: boolean }

function fmtDate(s: string) {
  return new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function FeatureFlags({ token }: { token: string }) {
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Pending | null>(null);
  const [feedback, setFeedback] = useState('');

  function load() {
    setLoading(true);
    api.featureFlags(token)
      .then(r => setFlags(r.data ?? []))
      .catch(() => setFeedback('Erro ao carregar flags.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [token]);

  async function applyChange(p: Pending) {
    setPending(null);
    try {
      await api.setFlag(token, p.flag.name, p.next);
      setFeedback(`Flag "${p.flag.name}" → ${p.next ? 'ativada' : 'desativada'}. Audit log registrado.`);
      load();
    } catch {
      setFeedback('Erro ao atualizar flag.');
    }
  }

  if (loading) return <div className="admin-empty"><div className="admin-empty__sub">Carregando...</div></div>;

  return (
    <>
      <div className="admin-page-header">
        <h1>Feature Flags</h1>
        <p>Controle de funcionalidades em produção. Toda alteração requer confirmação e gera audit log.</p>
      </div>

      {feedback && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: 'var(--blue-bg)', color: 'var(--blue)', borderRadius: 6, fontSize: 13 }}>
          {feedback}
          <button className="btn-ghost btn btn-sm" style={{ float: 'right' }} onClick={() => setFeedback('')}>×</button>
        </div>
      )}

      <div className="admin-card">
        <div className="admin-card__header">
          <span className="admin-card__title">{flags.length} flags configuradas</span>
          <span className="admin-card__sub">Alterações têm efeito imediato em produção</span>
        </div>
        {flags.length === 0 ? (
          <div className="admin-empty">
            <div className="admin-empty__title">Nenhuma flag encontrada</div>
            <div className="admin-empty__sub">Verifique a migration do Supabase.</div>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Flag</th>
                  <th>Descrição</th>
                  <th>Estado</th>
                  <th>Atualizado em</th>
                  <th>Por</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {flags.map(f => (
                  <tr key={f.name}>
                    <td><span className="mono" style={{ fontWeight: 600 }}>{f.name}</span></td>
                    <td className="text-muted" style={{ maxWidth: 260 }}>
                      {FLAG_DESCRIPTIONS[f.name] ?? f.description ?? '—'}
                    </td>
                    <td>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 12,
                        fontWeight: 500,
                        color: f.enabled ? 'var(--green)' : 'var(--text-3)',
                      }}>
                        <span style={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: f.enabled ? 'var(--green)' : 'var(--border-2)',
                          display: 'inline-block',
                        }} />
                        {f.enabled ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="text-muted text-xs">{fmtDate(f.updated_at)}</td>
                    <td className="text-muted text-xs mono">{f.updated_by ? f.updated_by.slice(0, 8) + '…' : '—'}</td>
                    <td>
                      <label className="admin-toggle">
                        <input
                          type="checkbox"
                          checked={f.enabled}
                          onChange={() => setPending({ flag: f, next: !f.enabled })}
                        />
                        <span className="admin-toggle__track" />
                        <span className="admin-toggle__thumb" />
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pending && (
        <ConfirmModal
          title={`${pending.next ? 'Ativar' : 'Desativar'} "${pending.flag.name}"`}
          body={`Esta alteração entra em vigor imediatamente em produção para todos os usuários. Um registro será criado no audit log com seu ID de administrador.`}
          confirmLabel={pending.next ? 'Ativar' : 'Desativar'}
          danger={!pending.next}
          onConfirm={() => applyChange(pending)}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
