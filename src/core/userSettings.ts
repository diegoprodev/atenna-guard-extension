import { sk } from './scopedStorage';

const LOCAL_KEY = 'atenna_badge_color';

export type BadgeColor = 'green' | 'blue' | 'yellow' | 'white' | 'red' | 'transparent';
export const DEFAULT_COLOR: BadgeColor = 'transparent';

function localGet(): Promise<BadgeColor> {
  return new Promise(resolve => {
    try {
      const key = sk(LOCAL_KEY);
      chrome.storage.local.get(key, r => {
        resolve((r[key] as BadgeColor | undefined) ?? DEFAULT_COLOR);
      });
    } catch { resolve(DEFAULT_COLOR); }
  });
}

function localSet(color: BadgeColor): void {
  try { chrome.storage.local.set({ [sk(LOCAL_KEY)]: color }); } catch { /* */ }
}

export async function getBadgeColor(_jwt?: string): Promise<BadgeColor> {
  return localGet();
}

export async function saveBadgeColor(color: BadgeColor, _jwt?: string, _userId?: string): Promise<void> {
  localSet(color);
}

export function applyBadgeColorToDom(color: BadgeColor): void {
  const btn = document.getElementById('atenna-guard-btn') as HTMLButtonElement | null;
  if (btn) btn.setAttribute('data-badge-color', color);
}
