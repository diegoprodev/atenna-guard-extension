const STORAGE_KEY = 'atenna_usage';
export const MONTHLY_LIMIT = 15;

export interface UsageData {
  count: number;
  resetDate: number; // ms timestamp
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
    const fresh: UsageData = {
      count: 0,
      resetDate: now + 30 * 24 * 60 * 60 * 1000,
    };
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
  return usage.count >= MONTHLY_LIMIT;
}
