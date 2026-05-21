import { useState } from 'react';

const BASE = 'https://atennaplugin.maestro-n8n.site';

interface Props {
  onLogin: (token: string) => void;
}

export function Login({ onLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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

  return (
    <div className="admin-login">
      <div className="admin-login__card">
        <div className="admin-login__logo">
          <img src="/nexussafe/logo.png" alt="Atenna" style={{ width: 32, height: 32, borderRadius: 7, objectFit: 'contain' }} />
          <span>Atenna Admin</span>
        </div>

        {error && <div className="admin-login__error">{error}</div>}

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

        <p style={{ marginTop: 20, fontSize: 11, color: 'var(--text-3)', textAlign: 'center', lineHeight: 1.5 }}>
          Acesso restrito a administradores.
          <br />Toda sessão é registrada.
        </p>
      </div>
    </div>
  );
}
