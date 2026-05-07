import type { PlatformConfig } from './detectInput';
import { scan } from '../dlp/detector';
import { getInputText, setInputText } from '../core/inputHandler';
import { rewritePII } from '../dlp/rewriter';
import type { DetectedEntity } from '../dlp/types';

const INJECTED_ATTR      = 'data-atenna-injected';
const BTN_ID             = 'atenna-guard-btn';
const BTN_CLASS          = 'atenna-btn';
const BADGE_RIGHT_OFFSET = 90;

let currentCleanup: (() => void) | undefined;
let rafId:          number | undefined;
let savedPos:       { top: number; left: number } | null = null;

// ── Settings ────────────────────────────────────────────────

let autoBannerEnabled = true;

// Read persisted setting at module load
try {
  chrome.storage.local.get('atenna_settings', (result) => {
    const s = result['atenna_settings'] as { autoBanner?: boolean } | undefined;
    if (s && typeof s.autoBanner === 'boolean') autoBannerEnabled = s.autoBanner;
  });
} catch { /* non-extension env */ }

export function setAutoBanner(enabled: boolean): void {
  autoBannerEnabled = enabled;
  try { chrome.storage.local.set({ atenna_settings: { autoBanner: enabled } }); } catch { /* */ }
}

// ── PT-BR labels for entity types ───────────────────────────

const ENTITY_LABELS: Record<string, string> = {
  CPF: 'CPF', CNPJ: 'CNPJ', EMAIL: 'E-mail', PHONE: 'Telefone',
  API_KEY: 'Chave API', TOKEN: 'Token', PASSWORD: 'Senha',
  CREDIT_CARD: 'Cartão', ADDRESS: 'Endereço', PROCESS_NUM: 'Processo',
  MEDICAL: 'Dado médico', LEGAL: 'Dado legal', GENERIC_PII: 'Dado pessoal',
  NAME: 'Nome',
};

function entityLabel(type: string): string {
  return ENTITY_LABELS[type] ?? type;
}

function isDarkPage(): boolean {
  try {
    const bg = getComputedStyle(document.body).backgroundColor;
    const m = bg.match(/\d+/g);
    if (m && m.length >= 3) return 0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2] < 128;
  } catch { /* */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// ── Protection banner state ─────────────────────────────────

let bannerEl:        HTMLElement | undefined;
let lastEntities:    DetectedEntity[] = [];
let lastScanInput:   HTMLElement | undefined;
let lastBannerBtn:   HTMLButtonElement | undefined;

function showProtectionBanner(
  input:    HTMLElement,
  btn:      HTMLButtonElement,
  entities: DetectedEntity[],
): void {
  lastEntities  = entities;
  lastScanInput = input;
  lastBannerBtn = btn;

  if (bannerEl) {
    // Update subtitle if already visible
    const sub = bannerEl.querySelector('.atenna-protection-banner__sub');
    if (sub) sub.textContent = buildSubtitle(entities);
    return;
  }

  const dark = isDarkPage();

  const banner = document.createElement('div');
  banner.id        = 'atenna-protection-banner';
  banner.className = 'atenna-protection-banner' + (dark ? ' atenna-protection-banner--dark' : '');

  const uniqueTypes = [...new Set(entities.map(e => e.type))];
  const count = uniqueTypes.length;

  const msg = document.createElement('p');
  msg.className   = 'atenna-protection-banner__msg';
  msg.textContent = `Dados sensíveis detectados${count > 1 ? ` (${count})` : ''}`;

  const sub = document.createElement('p');
  sub.className   = 'atenna-protection-banner__sub';
  sub.textContent = buildSubtitle(entities);

  const actions = document.createElement('div');
  actions.className = 'atenna-protection-banner__actions';

  const protectBtn = document.createElement('button');
  protectBtn.className   = 'atenna-protection-banner__btn atenna-protection-banner__btn--primary';
  protectBtn.textContent = 'Proteger dados';
  protectBtn.addEventListener('click', () => {
    const text      = getInputText(lastScanInput!);
    const rewritten = rewritePII(text, lastEntities);
    setInputText(lastScanInput!, rewritten);
    dismissProtectionBanner();
    updateBadgeDotRisk('NONE', 0);
  });

  const ignoreBtn = document.createElement('button');
  ignoreBtn.className   = 'atenna-protection-banner__btn';
  ignoreBtn.textContent = 'Enviar original';
  ignoreBtn.addEventListener('click', () => dismissProtectionBanner());

  actions.appendChild(protectBtn);
  actions.appendChild(ignoreBtn);
  banner.appendChild(msg);
  banner.appendChild(sub);
  banner.appendChild(actions);
  document.body.appendChild(banner);
  bannerEl = banner;

  positionBannerAbove(btn, banner);
}

function buildSubtitle(entities: DetectedEntity[]): string {
  return [...new Set(entities.map(e => e.type))].map(entityLabel).join(' · ');
}

function positionBannerAbove(btn: HTMLButtonElement, banner: HTMLElement): void {
  const btnRect = btn.getBoundingClientRect();
  banner.style.top   = 'auto';
  banner.style.right = `${window.innerWidth - btnRect.right}px`;
  // Position above badge: `bottom` = distance from viewport bottom to badge top, plus gap
  banner.style.bottom = `${window.innerHeight - btnRect.top + 8}px`;
}

function dismissProtectionBanner(): void {
  bannerEl?.remove();
  bannerEl       = undefined;
  lastEntities   = [];
  lastScanInput  = undefined;
  lastBannerBtn  = undefined;
}

function getLogoUrl(): string {
  try { return chrome.runtime.getURL('icons/icon128.png'); }
  catch { return ''; }
}

// ── Visual container detection ──────────────────────────────

function findVisualContainer(from: HTMLElement): HTMLElement {
  let el: HTMLElement | null = from;
  while (el && el !== document.body) {
    const rect   = el.getBoundingClientRect();
    const radius = parseFloat(getComputedStyle(el).borderRadius) || 0;
    if (radius >= 8 && rect.height >= 36 && rect.width >= 200) return el;
    el = el.parentElement as HTMLElement | null;
  }
  return from;
}

// ── Positioning ─────────────────────────────────────────────

function applyDefaultPosition(btn: HTMLButtonElement, input: HTMLElement): void {
  if (rafId !== undefined) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    const iRect = input.getBoundingClientRect();
    if (iRect.width === 0 || iRect.height === 0) return;
    const btnH = btn.getBoundingClientRect().height || 42;
    // Always ABOVE the input — never overlaps text the user is typing.
    // Gap of 8px between badge bottom and input top edge.
    btn.style.top   = `${iRect.top - btnH - 8}px`;
    btn.style.right = `${window.innerWidth - iRect.right + BADGE_RIGHT_OFFSET}px`;
    btn.style.left  = 'auto';
  });
}

function applySavedPosition(btn: HTMLButtonElement): void {
  if (!savedPos) return;
  const w   = btn.offsetWidth  || 120;
  const h   = btn.offsetHeight || 34;
  const top  = Math.max(0, Math.min(window.innerHeight - h, savedPos.top));
  const left = Math.max(0, Math.min(window.innerWidth  - w, savedPos.left));
  btn.style.right = 'auto';
  btn.style.left  = `${left}px`;
  btn.style.top   = `${top}px`;
}

function positionButton(btn: HTMLButtonElement, input: HTMLElement): void {
  if (savedPos) { applySavedPosition(btn); return; }
  applyDefaultPosition(btn, input);
}

// ── Drag behaviour ──────────────────────────────────────────

function addDragBehavior(btn: HTMLButtonElement, onToggle: () => void): void {
  btn.style.cursor = 'grab';
  let dragMoved = false;
  let startX = 0, startY = 0, startLeft = 0, startTop = 0;

  const onMouseMove = (e: MouseEvent) => {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!dragMoved && Math.hypot(dx, dy) < 5) return;
    dragMoved = true;
    btn.style.cursor = 'grabbing';
    btn.style.right  = 'auto';
    btn.style.left   = `${Math.max(0, Math.min(window.innerWidth  - btn.offsetWidth,  startLeft + dx))}px`;
    btn.style.top    = `${Math.max(0, Math.min(window.innerHeight - btn.offsetHeight, startTop  + dy))}px`;
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup',   onMouseUp);
    btn.style.cursor = 'grab';
    if (dragMoved) {
      savedPos = {
        top:  parseFloat(btn.style.top),
        left: parseFloat(btn.style.left),
      };
    }
  };

  btn.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    dragMoved = false;
    const rect = btn.getBoundingClientRect();
    startX = e.clientX; startY = e.clientY;
    startLeft = rect.left; startTop = rect.top;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   onMouseUp);
    e.preventDefault(); // prevent text selection while dragging
  });

  // Click fires after mouseup — skip it if a drag just occurred.
  btn.addEventListener('click', () => {
    if (dragMoved) { dragMoved = false; return; }
    // When auto-banner is OFF and there are HIGH entities: show banner on click
    if (!autoBannerEnabled && lastEntities.length > 0 && lastScanInput) {
      showProtectionBanner(lastScanInput, btn, lastEntities);
      return;
    }
    onToggle();
  });
}

// ── Public API ──────────────────────────────────────────────

export function injectButton(config: PlatformConfig, onToggle: () => void): void {
  const input = document.querySelector(config.inputSelector) as HTMLElement | null;
  if (!input) return;

  const container = input.parentElement as HTMLElement | null;
  if (!container) return;

  if (container.hasAttribute(INJECTED_ATTR)) {
    const existing = document.getElementById(BTN_ID) as HTMLButtonElement | null;
    if (existing) positionButton(existing, input);
    return;
  }

  // Conversation switched — clean up previous badge
  savedPos = null;
  currentCleanup?.();
  currentCleanup = undefined;
  document.getElementById(BTN_ID)?.remove();
  document.querySelector(`[${INJECTED_ATTR}]`)?.removeAttribute(INJECTED_ATTR);

  container.setAttribute(INJECTED_ATTR, 'true');

  const logoUrl = getLogoUrl();
  const btn = document.createElement('button');
  btn.id        = BTN_ID;
  btn.className = BTN_CLASS;
  btn.setAttribute('aria-label', 'Atenna Prompt');

  // ── Retractable badge: icon (always visible) + label (hover only) ──
  const iconWrap = document.createElement('span');
  iconWrap.className = 'atenna-btn__icon-wrap';

  if (logoUrl) {
    const img = document.createElement('img');
    img.className = 'atenna-btn__icon';
    img.src    = logoUrl;
    img.width  = 46;
    img.height = 46;
    img.alt    = '';
    img.setAttribute('aria-hidden', 'true');
    iconWrap.appendChild(img);
  }

  // Status dot — on btn directly so it stays visible when owl zooms out
  const dot = document.createElement('span');
  dot.className = 'atenna-btn__dot';

  // Expandable label (hidden by default, revealed on hover)
  const label = document.createElement('span');
  label.className = 'atenna-btn__label';

  const name = document.createElement('span');
  name.className = 'atenna-btn__name';
  name.textContent = 'ATENNA';

  label.appendChild(name);

  btn.appendChild(iconWrap);
  btn.appendChild(label);
  btn.appendChild(dot);
  addDragBehavior(btn, onToggle);

  document.body.appendChild(btn);

  Promise.resolve().then(() => applyDefaultPosition(btn, input));

  const update = () => positionButton(btn, input);
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update, { passive: true });

  // Realtime DLP scan — debounced 400ms after last keystroke
  let typingTimer: ReturnType<typeof setTimeout> | undefined;
  let scanTimer:   ReturnType<typeof setTimeout> | undefined;

  const onInput = () => {
    // Immediate visual: typing indicator
    const d = dot as HTMLElement;
    d.classList.remove('atenna-btn__dot--medium', 'atenna-btn__dot--high');
    d.classList.add('atenna-btn__dot--typing');
    d.setAttribute('data-tip', 'Digitando...');

    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      d.classList.remove('atenna-btn__dot--typing');
    }, 1500);

    // DLP scan fires 400ms after last keystroke (<50ms local, non-blocking)
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      const text = getInputText(input);
      if (!text || text.trim().length < 8) {
        updateBadgeDotRisk('NONE');
        dismissProtectionBanner();
        return;
      }
      const result = scan(text);
      const highEntities = result.entities.filter(e => result.riskLevel === 'HIGH');
      updateBadgeDotRisk(result.riskLevel, result.entities.length);

      if (result.riskLevel === 'HIGH') {
        if (autoBannerEnabled) showProtectionBanner(input, btn, result.entities);
        else { lastEntities = result.entities; lastScanInput = input; lastBannerBtn = btn; }
      } else {
        dismissProtectionBanner();
        if (result.riskLevel !== 'HIGH') { lastEntities = []; }
      }
      void highEntities;
    }, 400);
  };
  input.addEventListener('input', onInput);

  let ro: ResizeObserver | undefined;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(update);
    ro.observe(input); // track textarea/div growth directly
    ro.observe(findVisualContainer(input));
    ro.observe(document.documentElement);
  }

  currentCleanup = () => {
    window.removeEventListener('scroll', update);
    window.removeEventListener('resize', update);
    input.removeEventListener('input', onInput);
    clearTimeout(typingTimer);
    clearTimeout(scanTimer);
    dismissProtectionBanner();
    ro?.disconnect();
  };
}

function buildDotTip(level: string, count?: number): string {
  if (level === 'HIGH') {
    const n = count && count > 0 ? ` (${count})` : '';
    return `⚠ ${count === 1 ? '1 dado sensível' : `${count ?? ''} dados sensíveis`}${n ? '' : ' detectados'}`;
  }
  if (level === 'MEDIUM') return '◉ Possível dado sensível';
  if (level === 'LOW')    return '✓ Baixo risco';
  return '✓ Tudo seguro';
}

export function updateBadgeDotRisk(level: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH', count?: number): void {
  const dot = document.querySelector('#atenna-guard-btn .atenna-btn__dot') as HTMLElement | null;
  if (!dot) return;
  dot.classList.remove('atenna-btn__dot--typing', 'atenna-btn__dot--medium', 'atenna-btn__dot--high');
  dot.setAttribute('data-tip', buildDotTip(level, count));
  if (level === 'HIGH')        dot.classList.add('atenna-btn__dot--high');
  else if (level === 'MEDIUM') dot.classList.add('atenna-btn__dot--medium');
}

export function removeButton(inputSelector: string): void {
  const input = document.querySelector(inputSelector) as HTMLElement | null;
  if (!input) return;

  const container = input.parentElement as HTMLElement | null;
  if (container) container.removeAttribute(INJECTED_ATTR);

  currentCleanup?.();
  currentCleanup = undefined;
  document.getElementById(BTN_ID)?.remove();
}
