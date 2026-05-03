import type { PlatformConfig } from './detectInput';

const INJECTED_ATTR = 'data-atenna-injected';
const BTN_ID = 'atenna-guard-btn';
const BTN_CLASS = 'atenna-btn';
const BADGE_RIGHT_OFFSET = 90; // clears toolbar icons (mic, send) on all platforms

let currentCleanup: (() => void) | undefined;
let rafId: number | undefined;

function getLogoUrl(): string {
  try { return chrome.runtime.getURL('icons/icon128.png'); }
  catch { return ''; }
}

// Walks up from `from` to find the element that visually represents the input box.
// All three platforms (ChatGPT, Claude, Gemini) wrap the editable area in a rounded
// container (border-radius >= 8px, height >= 36px, width >= 200px).
function findVisualContainer(from: HTMLElement): HTMLElement {
  let el: HTMLElement | null = from;
  while (el && el !== document.body) {
    const rect = el.getBoundingClientRect();
    const radius = parseFloat(getComputedStyle(el).borderRadius) || 0;
    if (radius >= 8 && rect.height >= 36 && rect.width >= 200) {
      return el;
    }
    el = el.parentElement as HTMLElement | null;
  }
  return from;
}

function positionButton(btn: HTMLButtonElement, input: HTMLElement): void {
  if (rafId !== undefined) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    const container = findVisualContainer(input);
    const cRect = container.getBoundingClientRect();
    if (cRect.width === 0 || cRect.height === 0) return;

    const btnH = btn.getBoundingClientRect().height || 26;
    // Anchor to the BOTTOM edge of the container — stable when the input
    // grows upward (ChatGPT / Claude / Gemini behavior).
    btn.style.top    = `${cRect.bottom - btnH / 2}px`;
    btn.style.right  = `${window.innerWidth - cRect.right + BADGE_RIGHT_OFFSET}px`;
  });
}

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
  currentCleanup?.();
  currentCleanup = undefined;
  document.getElementById(BTN_ID)?.remove();
  document.querySelector(`[${INJECTED_ATTR}]`)?.removeAttribute(INJECTED_ATTR);

  container.setAttribute(INJECTED_ATTR, 'true');

  const logoUrl = getLogoUrl();
  const btn = document.createElement('button');
  btn.id = BTN_ID;
  btn.className = BTN_CLASS;
  btn.setAttribute('aria-label', 'Atenna Prompt');

  if (logoUrl) {
    const img = document.createElement('img');
    img.className = 'atenna-btn__icon';
    img.src = logoUrl;
    img.width = 26;
    img.height = 26;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    btn.appendChild(img);
  }

  btn.appendChild(document.createTextNode('Atenna Prompt'));
  btn.addEventListener('click', onToggle);

  document.body.appendChild(btn);

  // Initial position — defer one microtask so the browser can calculate layout
  Promise.resolve().then(() => positionButton(btn, input));

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
