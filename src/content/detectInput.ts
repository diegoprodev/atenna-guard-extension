export interface PlatformConfig {
  name: string;
  inputSelector: string;
}

// Non-chat path guards — return null to suppress badge injection on listing/settings pages.
const CLAUDE_NON_CHAT    = /^\/(chats|recents|settings|projects|files|artifacts|teams|upgrade)/;
const CHATGPT_NON_CHAT   = /^\/(gpts|auth|admin|settings|library)(\/?$|\/)/;
const GEMINI_NON_CHAT    = /^\/(apps|about|settings|u\/0\/settings|privacy|terms)(\/?$|\/)/;
const PERPLEXITY_NON_CHAT = /^\/(settings|collections|profile|sign-in|sign-up|api)(\/?$|\/)/;

export function detectPlatform(): PlatformConfig | null {
  const host = window.location.hostname;
  const path = window.location.pathname;

  if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) {
    if (CHATGPT_NON_CHAT.test(path)) return null;
    return { name: 'ChatGPT', inputSelector: '#prompt-textarea' };
  }

  if (host.includes('claude.ai')) {
    if (CLAUDE_NON_CHAT.test(path)) return null;
    // Use a more specific selector to avoid matching textareas inside settings modals.
    // The real chat ProseMirror editor sits inside .ProseMirror; the settings overlay
    // "Instruções para o Claude" is a div[contenteditable] inside role="dialog".
    // We resolve the ambiguity at injection time via isInsideDialog() in content.ts.
    return { name: 'Claude', inputSelector: 'div[contenteditable="true"]' };
  }

  if (host.includes('gemini.google.com')) {
    if (GEMINI_NON_CHAT.test(path)) return null;
    return { name: 'Gemini', inputSelector: 'div[contenteditable="true"]' };
  }

  if (host.includes('perplexity.ai')) {
    if (PERPLEXITY_NON_CHAT.test(path)) return null;
    // Perplexity uses a textarea for the main prompt input.
    return { name: 'Perplexity', inputSelector: 'textarea[placeholder], textarea[class*="grow"]' };
  }

  // Localhost fixture page for E2E tests
  if (host === 'localhost' || host === '127.0.0.1') {
    return { name: 'Test', inputSelector: '#prompt-textarea' };
  }

  return null;
}
