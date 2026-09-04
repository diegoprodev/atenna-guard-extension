import { sk } from './scopedStorage';

const LOCAL_KEY = 'atenna_badge_color';

export type BadgeColor = 'green' | 'blue' | 'yellow' | 'white' | 'red' | 'transparent';
export const DEFAULT_COLOR: BadgeColor = 'transparent';

// ── FASE 10.9.2 (B10) — estilo padrão da geração pela canetinha ──────────────
// 'ask' = mostra os 3 cards (comportamento atual). Os outros aplicam direto o
// estilo escolhido no chat, pulando a escolha.
const AUTOGEN_KEY = 'atenna_autogen_style';
export type AutoGenStyle = 'ask' | 'direct' | 'structured' | 'strategic';
export const DEFAULT_AUTOGEN: AutoGenStyle = 'ask';

/** Mapeia a preferência pro campo do payload de geração (technical == "Estratégico"). */
export function autoGenStyleKey(s: AutoGenStyle): 'direct' | 'structured' | 'technical' | null {
  if (s === 'direct') return 'direct';
  if (s === 'structured') return 'structured';
  if (s === 'strategic') return 'technical';
  return null;
}

export async function getAutoGenStyle(): Promise<AutoGenStyle> {
  return new Promise(resolve => {
    try {
      const key = sk(AUTOGEN_KEY);
      chrome.storage.local.get(key, r => resolve((r[key] as AutoGenStyle | undefined) ?? DEFAULT_AUTOGEN));
    } catch { resolve(DEFAULT_AUTOGEN); }
  });
}

export async function saveAutoGenStyle(style: AutoGenStyle): Promise<void> {
  return new Promise(resolve => {
    try { chrome.storage.local.set({ [sk(AUTOGEN_KEY)]: style }, () => resolve()); }
    catch { resolve(); }
  });
}

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
