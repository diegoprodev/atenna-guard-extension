/**
 * User settings — persisted in Supabase user_settings table.
 * Falls back to chrome.storage.local if offline or not authenticated.
 */

const SUPABASE_URL = 'https://kezbssjmgwtrunqeoyir.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtlemJzc2ptZ3d0cnVucWVveWlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MzY0NzcsImV4cCI6MjA5MzUxMjQ3N30.c2YNPrG7WcbwtFij8UJlS7BNxY_XeaKoeqPlrKHloKs';
const LOCAL_KEY    = 'atenna_badge_color';

export type BadgeColor = 'green' | 'blue' | 'yellow' | 'white' | 'red' | 'transparent';
export const DEFAULT_COLOR: BadgeColor = 'transparent';

function authHeaders(jwt: string) {
  return {
    'apikey':        SUPABASE_KEY,
    'Authorization': `Bearer ${jwt}`,
    'Content-Type':  'application/json',
    'Prefer':        'resolution=merge-duplicates,return=minimal',
  };
}

// ── Local fallback ───────────────────────────────────────────

function localGet(): Promise<BadgeColor> {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(LOCAL_KEY, r => {
        resolve((r[LOCAL_KEY] as BadgeColor | undefined) ?? DEFAULT_COLOR);
      });
    } catch { resolve(DEFAULT_COLOR); }
  });
}

function localSet(color: BadgeColor): void {
  try { chrome.storage.local.set({ [LOCAL_KEY]: color }); } catch { /* */ }
}

// ── Supabase read/write ──────────────────────────────────────

async function remoteGet(jwt: string): Promise<BadgeColor | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/user_settings?select=badge_color&limit=1`,
      { headers: authHeaders(jwt) },
    );
    if (!res.ok) return null;
    const rows = await res.json() as Array<{ badge_color: BadgeColor }>;
    return rows[0]?.badge_color ?? null;
  } catch { return null; }
}

async function remoteSet(jwt: string, userId: string, color: BadgeColor): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/user_settings`, {
      method:  'POST',
      headers: authHeaders(jwt),
      body:    JSON.stringify({ user_id: userId, badge_color: color }),
    });
  } catch { /* offline */ }
}

// ── Public API ───────────────────────────────────────────────

export async function getBadgeColor(jwt?: string): Promise<BadgeColor> {
  if (jwt) {
    const remote = await remoteGet(jwt);
    if (remote) { localSet(remote); return remote; }
  }
  return localGet();
}

export async function saveBadgeColor(color: BadgeColor, jwt?: string, userId?: string): Promise<void> {
  localSet(color);
  if (jwt && userId) await remoteSet(jwt, userId, color);
}

// ── Badge DOM helper (no import of injectButton) ─────────────

export function applyBadgeColorToDom(color: BadgeColor): void {
  const btn = document.getElementById('atenna-guard-btn') as HTMLButtonElement | null;
  if (btn) btn.setAttribute('data-badge-color', color);
}
