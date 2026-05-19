import { getSession, setSession, clearSession, Session } from './sessionManager';
import { withRefreshLock } from './refreshLock';

const BFF_BASE = 'https://atennaplugin.maestro-n8n.site';

interface MeResponse {
  user_id: string;
  email: string;
  plan: string;
  expires_at: number;
}

async function bffRefresh(token: string): Promise<boolean> {
  try {
    const r = await fetch(`${BFF_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!r.ok) return false;
    const s = await r.json() as Session;
    await setSession(s);
    return true;
  } catch {
    return false;
  }
}

export async function bffFetch<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const session = await getSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> ?? {}),
    ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
  };
  const r = await fetch(`${BFF_BASE}${path}`, { ...init, headers });
  if (r.status === 401 && retry && session) {
    const refreshed = await withRefreshLock(() => bffRefresh(session.token));
    if (refreshed) return bffFetch<T>(path, init, false);
    await clearSession();
    throw new Error('SESSION_EXPIRED');
  }
  if (!r.ok) throw new Error(`BFF ${path} → ${r.status}`);
  return r.json() as Promise<T>;
}

export async function bffLogin(email: string, password: string): Promise<Session> {
  const r = await fetch(`${BFF_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`Login failed: ${r.status}`);
  const s = await r.json() as Session;
  await setSession(s);
  return s;
}

export async function bffLogout(): Promise<void> {
  const session = await getSession();
  if (session) {
    await fetch(`${BFF_BASE}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: session.token }),
    }).catch(() => {});
  }
  await clearSession();
}

export async function bffMe(): Promise<MeResponse | null> {
  try {
    return await bffFetch<MeResponse>('/auth/me');
  } catch {
    return null;
  }
}

export async function bffResetPassword(email: string): Promise<void> {
  await fetch(`${BFF_BASE}/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  }).catch(() => {});
}
