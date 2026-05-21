import { describe, it, expect } from 'vitest';
import { detectPlatform } from './detectInput';

function setLocation(hostname: string, pathname = '/') {
  Object.defineProperty(window, 'location', {
    value: { hostname, pathname },
    writable: true,
    configurable: true,
  });
}

describe('detectPlatform', () => {
  it('returns ChatGPT config for chatgpt.com', () => {
    setLocation('chatgpt.com');
    const config = detectPlatform();
    expect(config!.name).toBe('ChatGPT');
    expect(config!.inputSelector).toBe('#prompt-textarea');
  });

  it('returns ChatGPT config for chat.openai.com', () => {
    setLocation('chat.openai.com');
    expect(detectPlatform()?.name).toBe('ChatGPT');
  });

  it('returns Claude config on chat page', () => {
    setLocation('claude.ai', '/chat/abc123');
    const config = detectPlatform();
    expect(config!.name).toBe('Claude');
    expect(config!.inputSelector).toContain('contenteditable');
  });

  it('returns Claude config on new conversation page', () => {
    setLocation('claude.ai', '/new');
    expect(detectPlatform()?.name).toBe('Claude');
  });

  it('returns null on claude.ai/chats (conversation history)', () => {
    setLocation('claude.ai', '/chats');
    expect(detectPlatform()).toBeNull();
  });

  it('returns null on claude.ai/recents', () => {
    setLocation('claude.ai', '/recents');
    expect(detectPlatform()).toBeNull();
  });

  it('returns null on claude.ai/settings', () => {
    setLocation('claude.ai', '/settings');
    expect(detectPlatform()).toBeNull();
  });

  it('returns Gemini config for gemini.google.com', () => {
    setLocation('gemini.google.com');
    const config = detectPlatform();
    expect(config!.name).toBe('Gemini');
    expect(config!.inputSelector).toContain('contenteditable');
  });

  it('returns null on gemini.google.com/settings', () => {
    setLocation('gemini.google.com', '/settings');
    expect(detectPlatform()).toBeNull();
  });

  it('returns Perplexity config for perplexity.ai', () => {
    setLocation('www.perplexity.ai', '/');
    const config = detectPlatform();
    expect(config!.name).toBe('Perplexity');
    expect(config!.inputSelector).toContain('textarea');
  });

  it('returns Perplexity config on search page', () => {
    setLocation('www.perplexity.ai', '/search/abc123');
    expect(detectPlatform()?.name).toBe('Perplexity');
  });

  it('returns null on perplexity.ai/settings', () => {
    setLocation('www.perplexity.ai', '/settings');
    expect(detectPlatform()).toBeNull();
  });

  it('returns null on perplexity.ai/collections', () => {
    setLocation('www.perplexity.ai', '/collections');
    expect(detectPlatform()).toBeNull();
  });

  it('returns null for unknown hostname', () => {
    setLocation('example.com');
    expect(detectPlatform()).toBeNull();
  });
});
