import { describe, it, expect } from 'vitest';
import { detectPlatform, type PlatformConfig } from './detectInput';

function setHostname(hostname: string) {
  Object.defineProperty(window, 'location', {
    value: { hostname },
    writable: true,
    configurable: true,
  });
}

describe('detectPlatform', () => {
  it('returns ChatGPT config for chatgpt.com', () => {
    setHostname('chatgpt.com');
    const config = detectPlatform();
    expect(config).not.toBeNull();
    expect(config!.name).toBe('ChatGPT');
    expect(config!.inputSelector).toBe('#prompt-textarea');
  });

  it('returns ChatGPT config for chat.openai.com', () => {
    setHostname('chat.openai.com');
    expect(detectPlatform()?.name).toBe('ChatGPT');
  });

  it('returns Claude config for claude.ai', () => {
    setHostname('claude.ai');
    const config = detectPlatform();
    expect(config!.name).toBe('Claude');
    expect(config!.inputSelector).toContain('contenteditable');
  });

  it('returns Gemini config for gemini.google.com', () => {
    setHostname('gemini.google.com');
    const config = detectPlatform();
    expect(config!.name).toBe('Gemini');
    expect(config!.inputSelector).toContain('contenteditable');
  });

  it('returns null for unknown hostname', () => {
    setHostname('example.com');
    expect(detectPlatform()).toBeNull();
  });
});
