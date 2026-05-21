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

function isElementVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const style = getComputedStyle(el as HTMLElement);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

// Returns true if el lives inside a modal/dialog overlay.
// Catches: Claude settings modal, any ARIA dialog, common modal class patterns.
function isInsideDialog(el: Element): boolean {
  return !!(
    el.closest('[role="dialog"]') ||
    el.closest('[aria-modal="true"]') ||
    el.closest('[data-radix-dialog-content]') ||
    el.closest('.modal') ||
    el.closest('[class*="modal"]') ||
    el.closest('[class*="dialog"]') ||
    el.closest('[class*="overlay"]') ||
    el.closest('aside[class*="settings"]')
  );
}

function removeBadge(): void {
  document.getElementById('atenna-guard-btn')?.remove();
  document.querySelector('[data-atenna-injected]')?.removeAttribute('data-atenna-injected');
}

function tryInject(): void {
  // Only inject badge if user is authenticated — DLP must not run without login
  if (!_isAuthenticated) return;

  const config = detectPlatform();
  if (!config) {
    // SPA navigated to a non-chat page — remove badge if present
    removeBadge();
    return;
  }

  const input = document.querySelector(config.inputSelector);
  if (!input) {
    // Input gone — remove stale badge
    removeBadge();
    return;
  }

  // Don't inject badge when the input is not visible (hidden pages, collapsed UI)
  if (!isElementVisible(input)) return;

  // Don't inject inside modal overlays — e.g. Claude settings modal has a
  // contenteditable "Instruções para o Claude" that matches our broad selector.
  if (isInsideDialog(input)) return;

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
  chrome.runtime.onMessage.addListener((msg: { type?: string; content?: string }) => {
    if (msg?.type === 'TOGGLE_MODAL') {
      // Ensure badge is injected before opening modal
      if (!_isAuthenticated) {
        _isAuthenticated = true;
        tryInject();
      }
      void toggleModal();
    }
    if (msg?.type === 'OPEN_SETTINGS') {
      void openSettingsOverlay();
    }
    if (msg?.type === 'INJECT_CONTENT_TO_CHAT' && msg.content) {
      injectContentIntoChat(msg.content);
    }
  });
} catch { /* non-extension env */ }

function injectContentIntoChat(content: string): void {
  // ChatGPT: native textarea
  const chatgptInput = document.querySelector('#prompt-textarea') as HTMLTextAreaElement | null;
  if (chatgptInput) {
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    nativeSetter?.call(chatgptInput, content);
    chatgptInput.dispatchEvent(new Event('input', { bubbles: true }));
    chatgptInput.focus();
    return;
  }
  // Claude / Gemini: contenteditable div
  const ceInput = document.querySelector(
    'div[contenteditable="true"][data-placeholder], .ql-editor, div[contenteditable="true"]'
  ) as HTMLElement | null;
  if (ceInput) {
    ceInput.focus();
    // Use execCommand so React/ProseMirror state stays in sync
    document.execCommand('selectAll', false);
    document.execCommand('insertText', false, content);
    ceInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// Only run in the top-level frame — iframes don't have storage access
// and don't contain the main chat input
if (window === window.top) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void init());
  } else {
    void init();
  }

  // SPA navigation: history.pushState does not fire popstate, so we patch it.
  // This covers ChatGPT navigating between /c/<id> and /gpts, /settings, etc.
  const _origPushState = history.pushState.bind(history);
  history.pushState = function (...args) {
    _origPushState(...args);
    // Give the SPA a tick to update the DOM before re-evaluating
    setTimeout(tryInject, 0);
  };
  window.addEventListener('popstate', () => setTimeout(tryInject, 0));
}
