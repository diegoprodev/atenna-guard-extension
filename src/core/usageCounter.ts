const STORAGE_KEY  = 'atenna_usage';
const TOTAL_KEY    = 'atenna_total_count';
const MONTHLY_KEY  = 'atenna_monthly_usage';
const SUPABASE_URL = 'https://kezbssjmgwtrunqeoyir.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtlemJzc2ptZ3d0cnVucWVveWlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MzY0NzcsImV4cCI6MjA5MzUxMjQ3N30.c2YNPrG7WcbwtFij8UJlS7BNxY_XeaKoeqPlrKHloKs';

export const DAILY_LIMIT = 10;   // must match backend DAILY_LIMIT_FREE in rate_limit.py
export const MONTHLY_LIMIT = 25;

export interface UsageData {
  count:     number;
  resetDate: number; // ms timestamp — midnight tonight
}

function midnightTonight(): number {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

async function storageGet(): Promise<UsageData | undefined> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(STORAGE_KEY, (result) =>
        resolve(result[STORAGE_KEY] as UsageData | undefined)
      );
    } catch {
      resolve(undefined);
    }
  });
}

async function storageSet(data: UsageData): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: data }, () => resolve());
    } catch {
      resolve();
    }
  });
}

export async function getUsage(): Promise<UsageData> {
  const raw = await storageGet();
  const now = Date.now();

  if (!raw || now >= raw.resetDate) {
    const fresh: UsageData = { count: 0, resetDate: midnightTonight() };
    await storageSet(fresh);
    return fresh;
  }

  return raw;
}

export async function incrementUsage(): Promise<UsageData> {
  const current = await getUsage();
  const updated: UsageData = { ...current, count: current.count + 1 };
  await storageSet(updated);
  return updated;
}

export function isAtLimit(usage: UsageData): boolean {
  return usage.count >= DAILY_LIMIT;
}

export async function isAtAnyLimit(usage: UsageData): Promise<boolean> {
  if (usage.count >= DAILY_LIMIT) return true;
  const monthly = await getMonthlyUsage();
  return monthly >= MONTHLY_LIMIT;
}

// ─── All-time total (never resets — used for conversion triggers) ──

export async function getTotalCount(): Promise<number> {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(TOTAL_KEY, r =>
        resolve((r[TOTAL_KEY] as number) ?? 0)
      );
    } catch { resolve(0); }
  });
}

export async function incrementTotalCount(): Promise<number> {
  const current = await getTotalCount();
  const next = current + 1;
  return new Promise(resolve => {
    try {
      chrome.storage.local.set({ [TOTAL_KEY]: next }, () => resolve(next));
    } catch { resolve(next); }
  });
}

// ─── Monthly usage (resets on 1st of month) ──

interface MonthlyData {
  count: number;
  resetMonth: string; // YYYY-MM format
}

function getCurrentMonth(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${m}`;
}

export async function getMonthlyUsage(): Promise<number> {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(MONTHLY_KEY, r => {
        const data = r[MONTHLY_KEY] as MonthlyData | undefined;
        const currentMonth = getCurrentMonth();
        if (!data || data.resetMonth !== currentMonth) {
          chrome.storage.local.set({ [MONTHLY_KEY]: { count: 0, resetMonth: currentMonth } }, () => resolve(0));
          return;
        }
        resolve(data.count);
      });
    } catch { resolve(0); }
  });
}

export async function incrementMonthlyUsage(): Promise<number> {
  const current = await getMonthlyUsage();
  const next = current + 1;
  const currentMonth = getCurrentMonth();
  return new Promise(resolve => {
    try {
      chrome.storage.local.set({ [MONTHLY_KEY]: { count: next, resetMonth: currentMonth } }, () => resolve(next));
    } catch { resolve(next); }
  });
}

export async function isAtMonthlyLimit(): Promise<boolean> {
  const usage = await getMonthlyUsage();
  return usage >= MONTHLY_LIMIT;
}

// ── Supabase usage sync ──────────────────────────────────────
// Queries analytics_events table for real prompt counts and merges with local storage.

export interface UsageSyncResult {
  todayCount:   number;
  monthlyCount: number;
  totalCount:   number;
}

export async function syncUsageFromSupabase(jwt: string): Promise<UsageSyncResult | null> {
  try {
    const todayStart  = new Date(); todayStart.setHours(0, 0, 0, 0);
    const monthStart  = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const todayMs     = todayStart.getTime();
    const monthMs     = monthStart.getTime();

    const headers = {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${jwt}`,
      'Content-Type':  'application/json',
    };

    // Fetch all prompt_generate_success events for this user
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/analytics_events?event_name=eq.prompt_generate_success&select=created_at`,
      { headers },
    );
    if (!res.ok) return null;

    const rows = await res.json() as Array<{ created_at: string }>;
    if (!Array.isArray(rows)) return null;

    const totalCount   = rows.length;
    const monthlyCount = rows.filter(r => new Date(r.created_at).getTime() >= monthMs).length;
    const todayCount   = rows.filter(r => new Date(r.created_at).getTime() >= todayMs).length;

    // Merge with local (take higher value — offline-first, no data loss)
    const [localUsage, localMonthly, localTotal] = await Promise.all([
      getUsage(), getMonthlyUsage(), getTotalCount(),
    ]);

    const mergedToday   = Math.max(todayCount,   localUsage.count);
    const mergedMonthly = Math.max(monthlyCount, localMonthly);
    const mergedTotal   = Math.max(totalCount,   localTotal);

    // Write merged back to local storage
    const currentMonth = getCurrentMonth();
    await Promise.all([
      new Promise<void>(r => { try { chrome.storage.local.set({ [TOTAL_KEY]: mergedTotal }, () => r()); } catch { r(); } }),
      new Promise<void>(r => { try { chrome.storage.local.set({ [MONTHLY_KEY]: { count: mergedMonthly, resetMonth: currentMonth } }, () => r()); } catch { r(); } }),
    ]);

    return { todayCount: mergedToday, monthlyCount: mergedMonthly, totalCount: mergedTotal };
  } catch {
    return null;
  }
}
