import { setStorageUser, userScopedKeys } from './scopedStorage';
import {
  getSession as bffGetSession,
  setSession as bffSetSession,
  clearSession as bffClearSession,
} from '../auth/sessionManager';
import { bffLogin, bffLogout, bffResetPassword, bffMe } from '../auth/bffClient';
import { AppError, E } from '../core/errors';

const JWT_KEY = 'atenna_jwt';

const USER_SCOPED_BASES = [
  'atenna_history',
  'atenna_usage',
  'atenna_total_count',
  'atenna_monthly_usage',
  'atenna_dlp_stats',
  'atenna_badge_color',
  'atenna_settings',
  'atenna_upload_count',
  'atenna_plan',
  'atenna_pro_welcome_pending',
];

export interface Session {
  access_token:  string;  // opaque BFF token (not a raw JWT)
  refresh_token?: string;
  email:         string;
  display_name?: string;
  expires_at:    number;
}

// ─── Storage helpers ──────────────────────────────────────
// Kept for backward compat with any code reading atenna_jwt key

export async function getStoredSession(): Promise<Session | null> {
  const bff = await bffGetSession();
  if (bff) {
    setStorageUser(bff.user_id);
    return {
      access_token: bff.token,
      email:        bff.email,
      expires_at:   bff.expires_at,
    };
  }
  // Legacy fallback: old unencrypted JWT in storage (migration path)
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(JWT_KEY, r =>
        resolve((r[JWT_KEY] as Session) ?? null)
      );
    } catch { resolve(null); }
  });
}

export async function storeSession(session: Session): Promise<void> {
  // No longer stores raw JWT — use bffSetSession for BFF sessions
  setStorageUser(session.email);
}

export async function clearSession(): Promise<void> {
  setStorageUser(null);
  await bffClearSession();
  return new Promise(resolve => {
    try {
      chrome.storage.local.remove(JWT_KEY, () => resolve());
    } catch { resolve(); }
  });
}

export async function resetOnboarding(): Promise<void> {
  return new Promise(resolve => {
    try {
      chrome.storage.local.remove('atenna_onboarding_seen', () => resolve());
    } catch { resolve(); }
  });
}

export function isSessionValid(session: Session): boolean {
  return Date.now() / 1000 < session.expires_at - 60;
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

// ─── Session check ────────────────────────────────────────

export async function getActiveSession(): Promise<Session | null> {
  const bff = await bffGetSession();
  if (bff) {
    setStorageUser(bff.user_id);
    return {
      access_token: bff.token,
      email:        bff.email,
      expires_at:   bff.expires_at,
    };
  }
  return null;
}

// ─── Auth actions ─────────────────────────────────────────

export async function signInWithPassword(email: string, password: string): Promise<{ error?: string; session?: Session }> {
  try {
    const s = await bffLogin(email, password);
    setStorageUser(s.user_id);
    return {
      session: {
        access_token: s.token,
        email:        s.email,
        expires_at:   s.expires_at,
      },
    };
  } catch (err) {
    if (err instanceof AppError) {
      if (err.code === E.INVALID_CREDENTIALS) return { error: 'Email ou senha incorretos.' };
      if (err.code === E.RATE_LIMIT) return { error: 'Muitas tentativas. Tente novamente em alguns minutos.' };
      if (err.code === E.NETWORK) return { error: 'Sem conexão. Verifique sua internet.' };
    }
    return { error: 'Erro ao fazer login. Tente novamente em alguns segundos.' };
  }
}

export async function signUpWithPassword(email: string, password: string, displayName?: string): Promise<{ error?: string }> {
  try {
    const BFF_BASE = 'https://atennaplugin.maestro-n8n.site';
    const r = await fetch(`${BFF_BASE}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, display_name: displayName }),
    });
    if (r.status === 400) {
      const body = await r.json().catch(() => ({})) as Record<string, unknown>;
      const err = (body.detail as { error?: string } | undefined)?.error ?? '';
      if (err === 'email_already_registered') return { error: 'Este email já está registrado.' };
      return { error: 'Email ou senha inválidos.' };
    }
    if (r.status === 422) return { error: 'Email em formato inválido.' };
    if (!r.ok) return { error: 'Erro ao criar conta. Tente novamente em alguns segundos.' };
    return {};
  } catch {
    return { error: 'Sem conexão. Verifique sua internet e tente novamente.' };
  }
}

export async function resetPassword(email: string): Promise<{ error?: string }> {
  try {
    await bffResetPassword(email);
    return {};
  } catch {
    return { error: 'Sem conexão. Verifique sua internet.' };
  }
}

export async function fetchDisplayName(session: Session): Promise<string | undefined> {
  const me = await bffMe();
  return me?.email;
}

export async function saveDisplayName(session: { email: string }, name: string): Promise<void> {
  try {
    const { getSession } = await import('../auth/sessionManager');
    const bff = await getSession();
    if (!bff) return;
    const BFF_BASE = 'https://atennaplugin.maestro-n8n.site';
    await fetch(`${BFF_BASE}/user/profile`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bff.token}`,
      },
      body: JSON.stringify({ display_name: name }),
    });
  } catch { /* silent */ }
}

export async function signOut(): Promise<void> {
  await bffLogout();
  setStorageUser(null);
  return new Promise(resolve => {
    try { chrome.storage.local.remove(JWT_KEY, () => resolve()); }
    catch { resolve(); }
  });
}

function getCallbackUrl(): string {
  return 'https://atennaplugin.maestro-n8n.site/auth/callback';
}
