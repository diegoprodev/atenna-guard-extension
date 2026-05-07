const STATS_KEY      = 'atenna_dlp_stats';
const SUPABASE_URL   = 'https://kezbssjmgwtrunqeoyir.supabase.co';
const SUPABASE_KEY   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtlemJzc2ptZ3d0cnVucWVveWlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MzY0NzcsImV4cCI6MjA5MzUxMjQ3N30.c2YNPrG7WcbwtFij8UJlS7BNxY_XeaKoeqPlrKHloKs';

export interface DlpStats {
  protectedCount:  number;  // times "Proteger dados" was clicked
  tokensEstimated: number;  // cumulative chars saved / 4
  scansTotal:      number;  // total DLP scans run
  updatedAt:       number;  // ms timestamp
}

const DEFAULT_STATS: DlpStats = {
  protectedCount:  0,
  tokensEstimated: 0,
  scansTotal:      0,
  updatedAt:       Date.now(),
};

function storageGet(): Promise<DlpStats> {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(STATS_KEY, r => {
        resolve((r[STATS_KEY] as DlpStats) ?? { ...DEFAULT_STATS });
      });
    } catch { resolve({ ...DEFAULT_STATS }); }
  });
}

function storageSet(s: DlpStats): Promise<void> {
  return new Promise(resolve => {
    try { chrome.storage.local.set({ [STATS_KEY]: s }, resolve); }
    catch { resolve(); }
  });
}

export async function getDlpStats(): Promise<DlpStats> {
  return storageGet();
}

export async function incrementProtected(charsSaved: number): Promise<void> {
  const s = await storageGet();
  s.protectedCount  += 1;
  s.tokensEstimated += Math.max(0, Math.round(charsSaved / 4));
  s.updatedAt        = Date.now();
  await storageSet(s);
}

export async function incrementScan(): Promise<void> {
  const s = await storageGet();
  s.scansTotal += 1;
  s.updatedAt   = Date.now();
  await storageSet(s);
}

// ── Supabase 2-way sync ──────────────────────────────────────

async function supabaseHeaders(jwt: string) {
  return {
    'apikey':        SUPABASE_KEY,
    'Authorization': `Bearer ${jwt}`,
    'Content-Type':  'application/json',
    'Prefer':        'return=representation',
  };
}

export async function pushDlpStatsToSupabase(jwt: string, userId: string): Promise<void> {
  try {
    const s = await storageGet();
    const headers = await supabaseHeaders(jwt);
    await fetch(`${SUPABASE_URL}/rest/v1/user_dlp_stats`, {
      method:  'POST',
      headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
      body:    JSON.stringify({
        user_id:          userId,
        protected_count:  s.protectedCount,
        tokens_estimated: s.tokensEstimated,
        scans_total:      s.scansTotal,
        updated_at:       new Date(s.updatedAt).toISOString(),
      }),
    });
  } catch { /* offline — silently ignore */ }
}

export async function fetchDlpStatsFromSupabase(jwt: string): Promise<DlpStats | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/user_dlp_stats?select=*&limit=1`,
      { headers: await supabaseHeaders(jwt) },
    );
    if (!res.ok) return null;
    const rows = await res.json() as Array<{
      protected_count: number; tokens_estimated: number; scans_total: number; updated_at: string;
    }>;
    if (!rows.length) return null;
    const r = rows[0];
    return {
      protectedCount:  r.protected_count,
      tokensEstimated: r.tokens_estimated,
      scansTotal:      r.scans_total,
      updatedAt:       new Date(r.updated_at).getTime(),
    };
  } catch { return null; }
}

// Merge: take the higher value for each counter (offline-first, no data loss)
export async function syncDlpStats(jwt: string, userId: string): Promise<DlpStats> {
  const [local, remote] = await Promise.all([storageGet(), fetchDlpStatsFromSupabase(jwt)]);
  if (!remote) { void pushDlpStatsToSupabase(jwt, userId); return local; }

  const merged: DlpStats = {
    protectedCount:  Math.max(local.protectedCount,  remote.protectedCount),
    tokensEstimated: Math.max(local.tokensEstimated, remote.tokensEstimated),
    scansTotal:      Math.max(local.scansTotal,      remote.scansTotal),
    updatedAt:       Date.now(),
  };

  await storageSet(merged);
  void pushDlpStatsToSupabase(jwt, userId); // push merged back
  return merged;
}
