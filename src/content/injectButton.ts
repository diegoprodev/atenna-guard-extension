import type { PlatformConfig } from './detectInput';

const INJECTED_ATTR    = 'data-atenna-injected';
const BTN_ID           = 'atenna-guard-btn';
const BTN_CLASS        = 'atenna-btn';
const BADGE_RIGHT_OFFSET = 90; // clears toolbar icons (mic, send) on all platforms

let currentCleanup: (() => void) | undefined;
let rafId:          number | undefined;
let savedPos:       { top: number; left: number } | null = null;

// ── Logo ────────────────────────────────────────────────────

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
    const container = findVisualContainer(input);
    const cRect = container.getBoundingClientRect();
    if (cRect.width === 0 || cRect.height === 0) return;
    const btnH = btn.getBoundingClientRect().height || 34;
    // Default: top-right — vertically centered on the top edge of the container.
    // Anchoring to cRect.top keeps the badge stable as the input grows downward.
    btn.style.top   = `${cRect.top - btnH / 2}px`;
    btn.style.right = `${window.innerWidth - cRect.right + BADGE_RIGHT_OFFSET}px`;
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

  if (logoUrl) {
    const img = document.createElement('img');
    img.className = 'atenna-btn__icon';
    img.src    = logoUrl;
    img.width  = 26;
    img.height = 26;
    img.alt    = '';
    img.setAttribute('aria-hidden', 'true');
    btn.appendChild(img);
  }

  btn.appendChild(document.createTextNode('Atenna Prompt'));
  addDragBehavior(btn, onToggle);

  document.body.appendChild(btn);

  Promise.resolve().then(() => applyDefaultPosition(btn, input));

  const update = () => positionButton(btn, input);
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update, { passive: true });

  let ro: ResizeObserver | undefined;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(update);
    ro.observe(findVisualContainer(input));
    ro.observe(document.documentElement);
  }

  currentCleanup = () => {
    window.removeEventListener('scroll', update);
    window.removeEventListener('resize', update);
    ro?.disconnect();
  };
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
