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

export interface UsageSummary {
  today:           number;
  monthly:         number;
  total:           number;
  protected_count: number;
  scans_total:     number;
}

export async function bffUsage(): Promise<UsageSummary | null> {
  try {
    return await bffFetch<UsageSummary>('/auth/usage');
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

  // Supabase OAuth uses implicit flow by default:
  // tokens arrive in the URL fragment (#access_token=...&refresh_token=...)
  // PKCE flow would use query param (?code=...) — support both.
  let body: Record<string, string>;
  try {
    const url = new URL(redirectUrl);
    const hash = new URLSearchParams(url.hash.slice(1));
    const accessToken = hash.get('access_token');
    const refreshToken = hash.get('refresh_token');

    if (accessToken) {
      body = { access_token: accessToken, refresh_token: refreshToken ?? '' };
    } else {
      const code = url.searchParams.get('code');
      if (!code) throw new AppError(E.NETWORK);
      body = { code, redirect_uri: redirectUri };
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(E.NETWORK);
  }

  let r: Response;
  try {
    r = await fetch(`${BFF_BASE}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
