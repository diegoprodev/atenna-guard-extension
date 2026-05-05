
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

// ─── Auth actions ─────────────────────────────────────────

export async function signInWithMagicLink(email: string): Promise<{ error?: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/magiclink`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body:    JSON.stringify({ email }),
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return {};
  } catch (e) {
    return { error: String(e) };
  }
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
