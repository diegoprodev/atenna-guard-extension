import { useState } from 'react';
import { API_BASE as BASE } from '../config';

interface Props {
  onLogin: (token: string) => void;
}

export function Login({ onLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [resetSent, setResetSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const r = await fetch(`${BASE}/auth/admin-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const d = await r.json();
      if (r.status === 403) {
        setError('Acesso restrito. Sua conta não possui permissão de administrador.');
        return;
      }
      if (!r.ok) throw new Error(d.detail ?? 'Credenciais inválidas.');
      onLogin(d.token);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido.');
    } finally {
      setLoading(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // Mesma rota do reset da extensão — o link do e-mail cai em
      // /auth/callback, que redefine a senha da conta Supabase (a mesma
      // usada pelo /auth/admin-login). Sempre 200, não vaza se o email existe.
      await fetch(`${BASE}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setResetSent(true);
    } catch {
      // resposta é sempre ok; falha só de rede
      setError('Sem conexão. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="admin-login">
      <div className="admin-login__card">
        <div className="admin-login__logo">
          <img src="/nexussafe/logo.png" alt="Atenna" style={{ width: 32, height: 32, borderRadius: 7, objectFit: 'contain' }} />
          <span>Atenna Admin</span>
        </div>

        {error && <div className="admin-login__error">{error}</div>}

        {mode === 'login' && (
          <>
            <form onSubmit={handleSubmit}>
              <div className="admin-login__field">
                <label className="admin-login__label">Email</label>
                <input
                  className="admin-login__input"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
              </div>
              <div className="admin-login__field">
                <label className="admin-login__label">Senha</label>
                <input
                  className="admin-login__input"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
              </div>
              <button className="admin-login__submit" type="submit" disabled={loading}>
                {loading ? 'Verificando...' : 'Entrar'}
              </button>
            </form>
            <button
              type="button"
              onClick={() => { setMode('forgot'); setError(''); }}
              style={{
                marginTop: 14, background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 12, color: 'var(--text-2, #6b7280)', textDecoration: 'underline',
                display: 'block', width: '100%', textAlign: 'center',
              }}
            >
              Esqueci minha senha
            </button>
          </>
        )}

        {mode === 'forgot' && !resetSent && (
          <form onSubmit={handleReset}>
            <p style={{ fontSize: 12, color: 'var(--text-2, #6b7280)', lineHeight: 1.5, marginBottom: 14 }}>
              Informe o email do admin. Enviamos um link para redefinir a senha.
            </p>
            <div className="admin-login__field">
              <label className="admin-login__label">Email</label>
              <input
                className="admin-login__input"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
            <button className="admin-login__submit" type="submit" disabled={loading}>
              {loading ? 'Enviando...' : 'Enviar link de redefinição'}
            </button>
            <button
              type="button"
              onClick={() => { setMode('login'); setError(''); }}
              style={{
                marginTop: 14, background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 12, color: 'var(--text-2, #6b7280)', textDecoration: 'underline',
                display: 'block', width: '100%', textAlign: 'center',
              }}
            >
              Voltar ao login
            </button>
          </form>
        )}

        {mode === 'forgot' && resetSent && (
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-1, #111827)' }}>
              Se <strong>{email}</strong> for uma conta de admin, o link de redefinição
              chegou no email. Abra o link, defina a nova senha e volte aqui para entrar.
            </p>
            <button
              type="button"
              onClick={() => { setMode('login'); setResetSent(false); setPassword(''); }}
              className="admin-login__submit"
              style={{ marginTop: 16 }}
            >
              Voltar ao login
            </button>
          </div>
        )}

        <p style={{ marginTop: 20, fontSize: 11, color: 'var(--text-3)', textAlign: 'center', lineHeight: 1.5 }}>
          Acesso restrito a administradores.
          <br />Toda sessão é registrada.
        </p>
      </div>
    </div>
  );
}
