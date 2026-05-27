import { detectPlatform } from './detectInput';
import { injectButton, removeButton } from './injectButton';
import { toggleModal, openSettingsOverlay } from '../ui/modal';
import { getSession } from '../auth/sessionManager';
import { setStorageUser } from '../core/scopedStorage';
import { attachImageInterceptor } from '../dlp/imageInterceptor';

// Cached session state — avoids re-checking on every MutationObserver tick
let _isAuthenticated = false;

async function checkAuth(): Promise<boolean> {
  try {
    const bffSession = await getSession();
    if (bffSession) {
      // Initialise user-scoped key prefix so modal's sk() calls resolve correctly
      setStorageUser(bffSession.user_id ?? null);
    }
    _isAuthenticated = !!bffSession;
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
// Catches: Claude settings modal, any ARIA dialog, Radix UI dialogs.
// Intentionally avoids [class*="overlay"] — too broad, blocks ChatGPT input containers.
function isInsideDialog(el: Element): boolean {
  return !!(
    el.closest('[role="dialog"]') ||
    el.closest('[aria-modal="true"]') ||
    el.closest('[data-radix-dialog-content]') ||
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
  attachImageInterceptor(config.inputSelector);
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
      if (area !== 'local' || (!('atenna_session' in changes) && !('atenna_jwt' in changes))) return;

      const newSession = changes['atenna_session']?.newValue ?? changes['atenna_jwt']?.newValue;
      if (newSession && !_isAuthenticated) {
        // Storage has a token — validate it before showing badge
        void checkAuth().then(authed => { if (authed) tryInject(); });
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
    if (msg?.type === 'INJECT_BADGE') {
      // Inject badge without opening modal — used after login from popup/welcome
      if (!_isAuthenticated) {
        void checkAuth().then(authed => { if (authed) tryInject(); });
      } else {
        tryInject();
      }
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
  const setTA = (ta: HTMLTextAreaElement): void => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(ta, content); else ta.value = content;
    ['input', 'change', 'keyup'].forEach(t => ta.dispatchEvent(new Event(t, { bubbles: true })));
    ta.focus();
  };
  const setCE = (el: HTMLElement): void => {
    el.focus();
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    const ok = document.execCommand('insertText', false, content);
    if (!ok) {
      const dt = new DataTransfer();
      dt.setData('text/plain', content);
      el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertFromPaste', dataTransfer: dt }));
      el.textContent = content;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: content }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  // ChatGPT: native textarea
  const chatgptTA = document.querySelector('#prompt-textarea') as HTMLTextAreaElement | null;
  if (chatgptTA) { setTA(chatgptTA); return; }
  // Perplexity / any platform using textarea
  const anyTA = document.querySelector('textarea') as HTMLTextAreaElement | null;
  if (anyTA) { setTA(anyTA); return; }
  // Claude / Gemini: contenteditable
  const ceInput = document.querySelector(
    'div[contenteditable="true"][data-placeholder], .ql-editor, div[contenteditable="true"]'
  ) as HTMLElement | null;
  if (ceInput) { setCE(ceInput); return; }
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
