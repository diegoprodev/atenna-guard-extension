const HISTORY_KEY = 'atenna_history';
const MAX_HISTORY = 20;

export interface PromptEntry {
  id: string;
  text: string;
  type: 'direct' | 'structured' | 'technical';
  date: number;
  favorited: boolean;
  origin: 'manual' | 'builder' | 'auto';
}

async function storageGet(): Promise<PromptEntry[]> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(HISTORY_KEY, (result) =>
        resolve((result[HISTORY_KEY] as PromptEntry[]) || [])
      );
    } catch {
      resolve([]);
    }
  });
}

async function storageSet(entries: PromptEntry[]): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ [HISTORY_KEY]: entries }, () => resolve());
    } catch {
      resolve();
    }
  });
}

export async function getHistory(): Promise<PromptEntry[]> {
  return storageGet();
}

export async function addToHistory(
  text: string,
  type: PromptEntry['type'],
  origin: PromptEntry['origin'],
): Promise<void> {
  const entries = await storageGet();
  const entry: PromptEntry = {
    id: 'ph_' + Math.random().toString(36).slice(2),
    text,
    type,
    date: Date.now(),
    favorited: false,
    origin,
  };
  entries.unshift(entry);
  if (entries.length > MAX_HISTORY) entries.pop();
  await storageSet(entries);
}

export async function toggleFavorite(id: string): Promise<void> {
  const entries = await storageGet();
  const entry = entries.find(e => e.id === id);
  if (entry) {
    entry.favorited = !entry.favorited;
    await storageSet(entries);
  }
}

export async function clearHistory(): Promise<void> {
  await storageSet([]);
}
