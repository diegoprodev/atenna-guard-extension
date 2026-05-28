// ─── Modal Utils — pure helpers and constants ─────────────────────────────────
// Extracted from modal.ts. No imports from other modal/* files.

export const OVERLAY_ID  = 'atenna-modal-overlay';
export const SUCCESS_MS  = 500;

export const LOADING_MESSAGES = [
  'Organizando intenção...',
  'Refinando contexto...',
  'Preparando versões...',
];

// Static SVGs — never contain user content, safe for innerHTML
export const CHECK_SVG = `<svg viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <circle cx="26" cy="26" r="25" stroke="#22c55e" stroke-width="2"/>
  <polyline points="14,27 22,35 38,17" stroke="#22c55e" stroke-width="3"
    stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export const COPY_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="9" y="9" width="13" height="13" rx="2"/>
  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
</svg>`;

// ─── Input analysis ──────────────────────────────────────

export function isVagueInput(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length === 1;
}

export function shouldSuggestBuilder(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length >= 80) return false;
  if (trimmed.includes('?')) return false;
  const actionVerbs = ['crie', 'explique', 'descreva', 'analise', 'gere', 'faça', 'escreva', 'organize', 'estruture'];
  return !actionVerbs.some(verb => trimmed.toLowerCase().includes(verb));
}

// ─── Focus trap ──────────────────────────────────────────

export function trapFocus(container: HTMLElement, onEscape: () => void): () => void {
  const focusable = () => Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter(el => el.offsetParent !== null);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { onEscape(); return; }
    if (e.key !== 'Tab') return;
    const els = focusable();
    if (!els.length) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', onKeyDown);
  return () => document.removeEventListener('keydown', onKeyDown);
}

// ─── Theme helper (must come before _textColor) ──────────

export function isDark(): boolean {
  // Check html/body dark class (Perplexity, Tailwind-based platforms)
  const root = document.documentElement;
  if (root.classList.contains('dark') || root.getAttribute('data-theme') === 'dark') return true;
  if (document.body.classList.contains('dark')) return true;
  // Check computed background luminance
  for (const el of [document.body, root]) {
    const bg = getComputedStyle(el).backgroundColor;
    const m = bg.match(/\d+/g);
    if (m && m.length >= 3 && !(+m[0] === 0 && +m[1] === 0 && +m[2] === 0 && (m[3] === '0' || m[3] === undefined))) {
      const lum = 0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2];
      const alpha = m[3] !== undefined ? parseFloat(m[3]) : 1;
      if (alpha > 0.1) return lum < 128;
    }
  }
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// ─── Settings stat helpers ────────────────────────────────

const _textColor = isDark() ? '#e8e8e8' : '#1a1a1a';
const S_ROW   = 'display:flex;align-items:center;gap:8px;padding:9px 14px;flex-wrap:wrap;min-height:38px;box-sizing:border-box;border-bottom:1px solid rgba(128,128,128,0.10);';
const S_LABEL = `flex:1;font-size:13px;color:${_textColor};opacity:0.78;line-height:1.4;font-family:inherit;`;
const S_VALUE = `font-size:13px;font-weight:700;color:${_textColor};font-variant-numeric:tabular-nums;font-family:inherit;`;
const S_SUB   = `width:100%;font-size:10px;color:${_textColor};opacity:0.40;margin-top:-3px;padding-bottom:2px;display:block;font-family:inherit;`;

export function makeProgressBar(value: number, max: number, color = '#22c55e'): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'atenna-stat-bar-wrap';
  wrap.style.cssText = 'height:5px;background:rgba(128,128,128,0.15);border-radius:3px;overflow:hidden;margin:0 14px 10px;display:block;';
  const fill = document.createElement('div');
  fill.className = 'atenna-stat-bar-fill';
  fill.style.cssText = `height:100%;border-radius:3px;min-width:0;background:${color};width:0%;transition:width 700ms cubic-bezier(0.34,1.1,0.64,1);display:block;`;
  const pct = max > 0 ? Math.min(100, Math.round(value / max * 100)) : 0;
  wrap.appendChild(fill);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    fill.style.width = `${pct}%`;
  }));
  return wrap;
}

export function makeStatRow(label: string, value: string, sub?: string, tooltip?: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'atenna-stat-row';
  row.style.cssText = S_ROW;
  if (tooltip) row.title = tooltip;
  const l = document.createElement('span');
  l.className = 'atenna-stat-label';
  l.style.cssText = S_LABEL;
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'atenna-stat-value';
  v.style.cssText = S_VALUE;
  v.textContent = value;
  row.appendChild(l);
  row.appendChild(v);
  if (sub) {
    const s = document.createElement('span');
    s.className = 'atenna-stat-sub';
    s.style.cssText = S_SUB;
    s.textContent = sub;
    row.appendChild(s);
  }
  return row;
}

export function makeSectionTitle(text: string): HTMLElement {
  const h = document.createElement('div');
  h.className = 'atenna-settings__section-title';
  h.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--at-text,#e8e8e8);opacity:0.45;padding:18px 4px 6px;font-family:inherit;';
  h.textContent = text;
  return h;
}

// ─── Interval / logo helpers ─────────────────────────────

// NOTE: msgIntervalId will be migrated to state.ts in Task 2.
// For now it lives here so clearMsgInterval() compiles standalone.
let msgIntervalId: ReturnType<typeof setInterval> | undefined;

export function clearMsgInterval(): void {
  if (msgIntervalId !== undefined) { clearInterval(msgIntervalId); msgIntervalId = undefined; }
}

export function getLogoUrl(): string {
  try { return chrome.runtime.getURL('icons/icon128.png'); }
  catch { return ''; }
}

// ─── Clipboard helpers ────────────────────────────────────

export function fallbackCopy(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

export function showToast(message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info'): void {
  document.querySelector('.atenna-modal-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = `atenna-modal-toast atenna-modal-toast--${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  const duration = type === 'error' ? 3500 : 2200;
  setTimeout(() => toast.remove(), duration);
}
