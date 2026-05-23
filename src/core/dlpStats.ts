import { sk } from './scopedStorage';

const STATS_KEY = 'atenna_dlp_stats';

export interface DlpStats {
  protectedCount:  number;
  tokensEstimated: number;
  scansTotal:      number;
  updatedAt:       number;
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
      const key = sk(STATS_KEY);
      chrome.storage.local.get(key, r => {
        resolve((r[key] as DlpStats) ?? { ...DEFAULT_STATS });
      });
    } catch { resolve({ ...DEFAULT_STATS }); }
  });
}

function storageSet(s: DlpStats): Promise<void> {
  return new Promise(resolve => {
    try { chrome.storage.local.set({ [sk(STATS_KEY)]: s }, resolve); }
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

// Kept for API compatibility — returns local stats (no remote sync with opaque BFF tokens)
export async function syncDlpStats(_jwt: string, _userId: string): Promise<DlpStats> {
  return storageGet();
}
