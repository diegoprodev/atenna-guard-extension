export interface PlatformConfig {
  name: string;
  inputSelector: string;
}

export function detectPlatform(): PlatformConfig | null {
  const host = window.location.hostname;

  if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) {
    return {
      name: 'ChatGPT',
      inputSelector: '#prompt-textarea',
    };
  }

  if (host.includes('claude.ai')) {
    return {
      name: 'Claude',
      inputSelector: 'div[contenteditable="true"]',
    };
  }

  if (host.includes('gemini.google.com')) {
    return {
      name: 'Gemini',
      inputSelector: 'div[contenteditable="true"]',
    };
  }

  return null;
}
