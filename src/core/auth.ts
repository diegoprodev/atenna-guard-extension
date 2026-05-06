
const SUPABASE_URL      = 'https://kezbssjmgwtrunqeoyir.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtlemJzc2ptZ3d0cnVucWVveWlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MzY0NzcsImV4cCI6MjA5MzUxMjQ3N30.c2YNPrG7WcbwtFij8UJlS7BNxY_XeaKoeqPlrKHloKs';
const JWT_KEY           = 'atenna_jwt';

export interface Session {
  access_token: string;
  email:        string;
  expires_at:   number; // unix seconds
}

// ─── Storage helpers ──────────────────────────────────────

export async function getStoredSession(): Promise<Session | null> {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(JWT_KEY, r =>
        resolve((r[JWT_KEY] as Session) ?? null)
      );
    } catch { resolve(null); }
  });
}

export async function storeSession(session: Session): Promise<void> {
  return new Promise(resolve => {
    try {
      chrome.storage.local.set({ [JWT_KEY]: session }, () => resolve());
    } catch { resolve(); }
  });
}

export async function clearSession(): Promise<void> {
  return new Promise(resolve => {
    try {
      chrome.storage.local.remove(JWT_KEY, () => resolve());
    } catch { resolve(); }
  });
}

export function isSessionValid(session: Session): boolean {
  return Date.now() / 1000 < session.expires_at - 60; // 60s buffer
}

export async function getActiveSession(): Promise<Session | null> {
  const session = await getStoredSession();
  if (!session) return null;
  if (!isSessionValid(session)) { await clearSession(); return null; }

  // Verify user still exists in Supabase (catches deleted accounts)
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${session.access_token}`,
      },
    });
    if (res.status === 401 || res.status === 403) {
      await clearSession();
      return null;
    }
  } catch {
    // Offline — trust cached session to avoid locking out users without internet
  }

  return session;
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid JWT format');
    const decoded = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded);
  } catch {
    return {};
  }
}

// ─── Auth actions ─────────────────────────────────────────

export async function signInWithPassword(email: string, password: string): Promise<{ error?: string; session?: Session }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body:    JSON.stringify({ email, password }),
    });
    if (res.status === 400 || res.status === 401) return { error: 'Email ou senha incorretos.' };
    if (res.status === 422) return { error: 'Email em formato inválido.' };
    if (!res.ok) return { error: 'Erro ao fazer login. Tente novamente em alguns segundos.' };

    const body = await res.json() as Record<string, unknown>;
    const accessToken = body.access_token as string;
    const expiresIn = body.expires_in as number || 3600;
    const payload = decodeJwtPayload(accessToken);
    const userEmail = (payload.email as string) || email;

    const session: Session = {
      access_token: accessToken,
      email: userEmail,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    };
    await storeSession(session);
    return { session };
  } catch (e) {
    return { error: 'Sem conexão. Verifique sua internet e tente novamente.' };
  }
}

export async function signUpWithPassword(email: string, password: string): Promise<{ error?: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body:    JSON.stringify({ email, password, options: { emailRedirectTo: getCallbackUrl() } }),
    });
    if (res.status === 400) {
      try {
        const body = await res.json() as Record<string, unknown>;
        const msg = (body.msg as string) || (body.message as string) || '';
        if (msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('user already exists')) return { error: 'Este email já está registrado.' };
        if (msg.toLowerCase().includes('password')) return { error: 'Senha deve ter no mínimo 6 caracteres.' };
      } catch {
        return { error: 'Email ou senha inválidos.' };
      }
      return { error: 'Email ou senha inválidos.' };
    }
    if (res.status === 422) return { error: 'Email em formato inválido.' };
    if (!res.ok) return { error: 'Erro ao criar conta. Tente novamente em alguns segundos.' };
    return {};
  } catch (e) {
    return { error: 'Sem conexão. Verifique sua internet e tente novamente.' };
  }
}

export async function resetPassword(email: string): Promise<{ error?: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body:    JSON.stringify({ email, redirectTo: getCallbackUrl() }),
    });
    if (res.status === 400) return { error: 'Email não encontrado ou inválido.' };
    if (res.status === 422) return { error: 'Email em formato inválido.' };
    if (!res.ok) return { error: 'Erro ao enviar. Tente novamente em alguns segundos.' };
    return {};
  } catch (e) {
    return { error: 'Sem conexão. Verifique sua internet e tente novamente.' };
  }
}

function getCallbackUrl(): string {
  return 'https://atennaplugin.maestro-n8n.site/auth/callback';
}

export async function signOut(): Promise<void> {
  const session = await getStoredSession();
  if (session) {
    // Best-effort server-side invalidation
    try {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method:  'POST',
        headers: {
          'apikey':        SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${session.access_token}`,
        },
      });
    } catch { /* ignore */ }
  }
  await clearSession();
}
