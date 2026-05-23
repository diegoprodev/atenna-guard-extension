import { sk } from './scopedStorage';

const STORAGE_KEY  = 'atenna_usage';
const TOTAL_KEY    = 'atenna_total_count';
const MONTHLY_KEY  = 'atenna_monthly_usage';

export const DAILY_LIMIT   = 5;
export const MONTHLY_LIMIT = 25;

export interface UsageData {
  count:     number;
  resetDate: number;
}

function midnightTonight(): number {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

async function storageGet(): Promise<UsageData | undefined> {
  return new Promise((resolve) => {
    try {
      const key = sk(STORAGE_KEY);
      chrome.storage.local.get(key, (result) =>
        resolve(result[key] as UsageData | undefined)
      );
    } catch {
      resolve(undefined);
    }
  });
}

async function storageSet(data: UsageData): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ [sk(STORAGE_KEY)]: data }, () => resolve());
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

export async function getTotalCount(): Promise<number> {
  return new Promise(resolve => {
    try {
      const key = sk(TOTAL_KEY);
      chrome.storage.local.get(key, r =>
        resolve((r[key] as number) ?? 0)
      );
    } catch { resolve(0); }
  });
}

export async function incrementTotalCount(): Promise<number> {
  const current = await getTotalCount();
  const next = current + 1;
  return new Promise(resolve => {
    try {
      chrome.storage.local.set({ [sk(TOTAL_KEY)]: next }, () => resolve(next));
    } catch { resolve(next); }
  });
}

interface MonthlyData {
  count: number;
  resetMonth: string;
}

function getCurrentMonth(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${m}`;
}

export async function getMonthlyUsage(): Promise<number> {
  return new Promise(resolve => {
    try {
      const key = sk(MONTHLY_KEY);
      chrome.storage.local.get(key, r => {
        const data = r[key] as MonthlyData | undefined;
        const currentMonth = getCurrentMonth();
        if (!data || data.resetMonth !== currentMonth) {
          chrome.storage.local.set({ [sk(MONTHLY_KEY)]: { count: 0, resetMonth: currentMonth } }, () => resolve(0));
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
      chrome.storage.local.set({ [sk(MONTHLY_KEY)]: { count: next, resetMonth: currentMonth } }, () => resolve(next));
    } catch { resolve(next); }
  });
}

export async function isAtMonthlyLimit(): Promise<boolean> {
  const usage = await getMonthlyUsage();
  return usage >= MONTHLY_LIMIT;
}

export interface UsageSyncResult {
  todayCount:   number;
  monthlyCount: number;
  totalCount:   number;
}

// Kept for API compatibility — returns local counts (no remote Supabase sync)
export async function syncUsageFromSupabase(_jwt: string): Promise<UsageSyncResult | null> {
  const [local, monthly, total] = await Promise.all([getUsage(), getMonthlyUsage(), getTotalCount()]);
  return { todayCount: local.count, monthlyCount: monthly, totalCount: total };
}
