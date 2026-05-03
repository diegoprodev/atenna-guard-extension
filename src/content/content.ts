import { detectPlatform } from './detectInput';
import { injectButton } from './injectButton';
import { togglePanel } from '../ui/panel';

function tryInject(): void {
  const config = detectPlatform();
  if (!config) return;

  const input = document.querySelector(config.inputSelector);
  if (!input) return;

  injectButton(config, () => togglePanel(config.name));
}

function init(): void {
  tryInject();

  const observer = new MutationObserver(() => {
    tryInject();
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
