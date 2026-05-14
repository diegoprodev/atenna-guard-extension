import { detectPlatform } from './detectInput';
import { injectButton, removeButton } from './injectButton';
import { toggleModal, openSettingsOverlay } from '../ui/modal';
import { getActiveSession } from '../core/auth';

// Cached session state — avoids re-checking on every MutationObserver tick
let _isAuthenticated = false;

async function checkAuth(): Promise<boolean> {
  try {
    const session = await getActiveSession();
    _isAuthenticated = !!session;
  } catch {
    _isAuthenticated = false;
  }
  return _isAuthenticated;
}

function tryInject(): void {
  // Only inject badge if user is authenticated — DLP must not run without login
  if (!_isAuthenticated) return;

  const config = detectPlatform();
  if (!config) return;

  const input = document.querySelector(config.inputSelector);
  if (!input) return;

  injectButton(config, () => toggleModal());
}

async function init(): Promise<void> {
  const authed = await checkAuth();

  // Only inject if authenticated
  if (authed) tryInject();

  // Re-inject on DOM changes (SPA navigation, conversation switch)
  const observer = new MutationObserver(() => {
    if (_isAuthenticated) tryInject();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // React to login / logout in another tab or popup
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !('atenna_jwt' in changes)) return;

      const newSession = changes['atenna_jwt']?.newValue;
      if (newSession && !_isAuthenticated) {
        // User just logged in — inject
        _isAuthenticated = true;
        tryInject();
      } else if (!newSession && _isAuthenticated) {
        // User logged out — remove badge
        _isAuthenticated = false;
        const config = detectPlatform();
        if (config) removeButton(config.inputSelector);
      }
    });
  } catch { /* non-extension env */ }
}

// Listen for messages from popup
try {
  chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
    if (msg?.type === 'OPEN_SETTINGS') {
      void openSettingsOverlay();
    }
  });
} catch { /* non-extension env */ }

// Only run in the top-level frame — iframes don't have storage access
// and don't contain the main chat input
if (window === window.top) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void init());
  } else {
    void init();
  }
}
