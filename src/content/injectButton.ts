import type { PlatformConfig } from './detectInput';

const INJECTED_ATTR = 'data-atenna-injected';
const BTN_CLASS = 'atenna-btn';

export function injectButton(config: PlatformConfig, onToggle: () => void): void {
  const input = document.querySelector(config.inputSelector) as HTMLElement | null;
  if (!input) return;

  const container = input.parentElement as HTMLElement | null;
  if (!container || container.hasAttribute(INJECTED_ATTR)) return;

  container.setAttribute(INJECTED_ATTR, 'true');

  const pos = getComputedStyle(container).position;
  if (pos === 'static' || pos === '') {
    container.style.position = 'relative';
  }
  container.style.paddingTop = '30px';

  const btn = document.createElement('button');
  btn.className = BTN_CLASS;
  btn.textContent = 'Atenna Guard Prompt';
  btn.setAttribute('aria-label', 'Atenna Guard Prompt');
  btn.addEventListener('click', onToggle);

  container.insertBefore(btn, container.firstChild);
}

export function removeButton(inputSelector: string): void {
  const input = document.querySelector(inputSelector) as HTMLElement | null;
  if (!input) return;

  const container = input.parentElement as HTMLElement | null;
  if (!container) return;

  container.removeAttribute(INJECTED_ATTR);
  container.style.paddingTop = '';

  container.querySelector(`.${BTN_CLASS}`)?.remove();
}
