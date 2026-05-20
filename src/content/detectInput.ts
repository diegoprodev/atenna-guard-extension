export interface PlatformConfig {
  name: string;
  inputSelector: string;
}

// Pages that exist on claude.ai but have no chat input — only listing/settings UI.
// The contenteditable selector would otherwise match the search bar on /chats.
const CLAUDE_NON_CHAT = /^\/(chats|recents|settings|projects|files|artifacts|teams|upgrade)/;

export function detectPlatform(): PlatformConfig | null {
  const host = window.location.hostname;
  const path = window.location.pathname;

  if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) {
    return { name: 'ChatGPT', inputSelector: '#prompt-textarea' };
  }

  if (host.includes('claude.ai')) {
    if (CLAUDE_NON_CHAT.test(path)) return null;
    return { name: 'Claude', inputSelector: 'div[contenteditable="true"]' };
  }

  if (host.includes('gemini.google.com')) {
    return { name: 'Gemini', inputSelector: 'div[contenteditable="true"]' };
  }

  // Localhost fixture page for E2E tests
  if (host === 'localhost' || host === '127.0.0.1') {
    return { name: 'Test', inputSelector: '#prompt-textarea' };
  }

  return null;
}
