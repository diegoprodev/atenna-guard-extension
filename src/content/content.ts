import { detectPlatform } from './detectInput';
import { injectButton } from './injectButton';
import { toggleModal } from '../ui/modal';

function tryInject(): void {
  const config = detectPlatform();
  if (!config) return;

  const input = document.querySelector(config.inputSelector);
  if (!input) return;

  injectButton(config, () => toggleModal());
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
