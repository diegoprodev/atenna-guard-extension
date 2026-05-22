import { getSession, setSession, clearSession, Session } from './sessionManager';
import { withRefreshLock } from './refreshLock';
import { AppError, E } from '../core/errors';

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
  let r: Response;
  try {
    r = await fetch(`${BFF_BASE}${path}`, { ...init, headers });
  } catch {
    throw new AppError(E.NETWORK);
  }
  if (r.status === 401 && retry && session) {
    const refreshed = await withRefreshLock(() => bffRefresh(session.token));
    if (refreshed) return bffFetch<T>(path, init, false);
    await clearSession();
    throw new AppError(E.SESSION_EXPIRED);
  }
  if (r.status === 429) throw new AppError(E.RATE_LIMIT);
  if (r.status >= 500)  throw new AppError(E.SERVER);
  if (!r.ok)            throw new AppError(E.SERVER);
  return r.json() as Promise<T>;
}

export async function bffLogin(email: string, password: string): Promise<Session> {
  let r: Response;
  try {
    r = await fetch(`${BFF_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new AppError(E.NETWORK);
  }
  if (r.status === 401 || r.status === 400) throw new AppError(E.INVALID_CREDENTIALS);
  if (r.status === 429)                     throw new AppError(E.RATE_LIMIT);
  if (r.status >= 500)                      throw new AppError(E.SERVER);
  if (!r.ok)                                throw new AppError(E.SERVER);
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

const SUPABASE_PROJECT_REF = 'kezbssjmgwtrunqeoyir';

export async function bffGoogleLogin(): Promise<Session> {
  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
  const authUrl =
    `https://${SUPABASE_PROJECT_REF}.supabase.co/auth/v1/authorize` +
    `?provider=google&redirect_to=${encodeURIComponent(redirectUri)}`;

  const redirectUrl = await new Promise<string | undefined>(resolve => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, resolve);
  });

  if (!redirectUrl) throw new AppError(E.NETWORK);

  let code: string | null = null;
  try {
    code = new URL(redirectUrl).searchParams.get('code');
  } catch {
    throw new AppError(E.NETWORK);
  }
  if (!code) throw new AppError(E.NETWORK);

  let r: Response;
  try {
    r = await fetch(`${BFF_BASE}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirect_uri: redirectUri }),
    });
  } catch {
    throw new AppError(E.NETWORK);
  }

  if (r.status === 401 || r.status === 400) throw new AppError(E.INVALID_CREDENTIALS);
  if (r.status === 429)                     throw new AppError(E.RATE_LIMIT);
  if (r.status >= 500)                      throw new AppError(E.SERVER);
  if (!r.ok)                                throw new AppError(E.SERVER);

  const s = await r.json() as Session;
  await setSession(s);
  return s;
}
