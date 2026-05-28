import { sk } from './scopedStorage';
import { DLP_PATTERNS } from '../dlp/patterns';

const HISTORY_KEY = 'atenna_history';
const MAX_HISTORY = 30;

export interface PromptEntry {
  id: string;
  text: string;
  type: 'direct' | 'structured' | 'technical';
  date: number;
  favorited: boolean;
  origin: 'manual' | 'builder' | 'auto';
}

/** Group: user question + all 3 generated variants */
export interface HistoryGroup {
  id: string;
  question: string;          // original user input
  date: number;
  favorited: boolean;
  origin: 'manual' | 'builder' | 'auto';
  variants: {
    direct?: string;
    structured?: string;
    technical?: string;
  };
}

type StoredEntry = PromptEntry | HistoryGroup;

function isGroup(e: StoredEntry): e is HistoryGroup {
  return 'variants' in e;
}

async function storageGet(): Promise<StoredEntry[]> {
  return new Promise((resolve) => {
    try {
      const key = sk(HISTORY_KEY);
      chrome.storage.local.get(key, (result) =>
        resolve((result[key] as StoredEntry[]) || [])
      );
    } catch {
      resolve([]);
    }
  });
}

async function storageSet(entries: StoredEntry[]): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ [sk(HISTORY_KEY)]: entries }, () => resolve());
    } catch {
      resolve();
    }
  });
}

export async function getHistory(): Promise<StoredEntry[]> {
  return storageGet();
}

function maskPII(text: string): string {
  let result = text;
  for (const { type, pattern, validate } of DLP_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    re.lastIndex = 0;
    result = result.replace(re, (match) => {
      if (validate && !validate(match)) return match;
      return `[${type}]`;
    });
  }
  return result;
}

/** Save all 3 variants grouped under the user's original question */
export async function addGroupToHistory(
  question: string,
  variants: HistoryGroup['variants'],
  origin: HistoryGroup['origin'],
): Promise<void> {
  const entries = await storageGet();
  const group: HistoryGroup = {
    id: 'hg_' + Math.random().toString(36).slice(2),
    question: maskPII(question),
    date: Date.now(),
    favorited: false,
    origin,
    variants,
  };
  entries.unshift(group);
  if (entries.length > MAX_HISTORY) entries.pop();
  await storageSet(entries);
}

/** Legacy: save single prompt (kept for compatibility) */
export async function addToHistory(
  text: string,
  type: PromptEntry['type'],
  origin: PromptEntry['origin'],
): Promise<void> {
  // no-op: use addGroupToHistory instead
  void text; void type; void origin;
}

export async function toggleFavorite(id: string): Promise<void> {
  const entries = await storageGet();
  const entry = entries.find(e => e.id === id);
  if (entry) {
    (entry as PromptEntry | HistoryGroup).favorited = !entry.favorited;
    await storageSet(entries);
  }
}

export async function clearHistory(): Promise<void> {
  await storageSet([]);
}

export { isGroup };
