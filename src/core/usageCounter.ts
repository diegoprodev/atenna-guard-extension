const STORAGE_KEY = 'atenna_usage';
const TOTAL_KEY   = 'atenna_total_count';
const MONTHLY_KEY = 'atenna_monthly_usage';

export const DAILY_LIMIT = 10;
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
