import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { injectButton, removeButton } from './injectButton';
import type { PlatformConfig } from './detectInput';

const chatgpt: PlatformConfig = { name: 'ChatGPT', inputSelector: '#prompt-textarea' };

// jsdom stubs
const disconnectMock = vi.fn();
vi.stubGlobal('ResizeObserver', class {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = disconnectMock;
});
vi.stubGlobal('chrome', {
  runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
  storage: {
    local: {
      get: vi.fn().mockImplementation((_key: string, cb: (r: Record<string, unknown>) => void) => cb({})),
      set: vi.fn(),
    },
  },
});

function setup() {
  document.body.innerHTML = '<div id="parent"><textarea id="prompt-textarea"></textarea></div>';
}

describe('injectButton', () => {
  beforeEach(setup);
  afterEach(() => { document.getElementById('atenna-guard-btn')?.remove(); });

  it('appends #atenna-guard-btn to document.body', () => {
    injectButton(chatgpt, () => {});
    expect(document.getElementById('atenna-guard-btn')).not.toBeNull();
  });

  it('does not inject twice for the same container (idempotent)', () => {
    injectButton(chatgpt, () => {});
    injectButton(chatgpt, () => {});
    expect(document.querySelectorAll('.atenna-btn').length).toBe(1);
  });

  it('button label contains "Atenna Prompt"', () => {
    injectButton(chatgpt, () => {});
    const btn = document.getElementById('atenna-guard-btn') as HTMLButtonElement;
    expect(btn.textContent).toContain('Atenna Prompt');
  });

  it('button contains logo img', () => {
    injectButton(chatgpt, () => {});
    const btn = document.getElementById('atenna-guard-btn') as HTMLButtonElement;
    expect(btn.querySelector('img')).not.toBeNull();
  });

  it('logo img src uses chrome.runtime.getURL', () => {
    injectButton(chatgpt, () => {});
    const img = document.querySelector('.atenna-btn__icon') as HTMLImageElement;
    expect(img.src).toContain('icons/icon128.png');
  });

  it('marks container with data-atenna-injected', () => {
    injectButton(chatgpt, () => {});
    expect(document.getElementById('parent')!.getAttribute('data-atenna-injected')).toBe('true');
  });

  it('calls onToggle when clicked', () => {
    const toggle = vi.fn();
    injectButton(chatgpt, toggle);
    (document.getElementById('atenna-guard-btn') as HTMLButtonElement).click();
    expect(toggle).toHaveBeenCalledOnce();
  });

  it('replaces badge when container changes (conversation switch)', () => {
    injectButton(chatgpt, () => {});
    // Simulate DOM replacement: new container without the attribute
    document.body.innerHTML = '<div id="parent2"><textarea id="prompt-textarea"></textarea></div>';
    injectButton(chatgpt, () => {});
    expect(document.querySelectorAll('.atenna-btn').length).toBe(1);
    expect(document.getElementById('parent2')!.getAttribute('data-atenna-injected')).toBe('true');
  });

  it('does nothing if input selector matches nothing', () => {
    document.body.innerHTML = '<div></div>';
    injectButton(chatgpt, () => {});
    expect(document.getElementById('atenna-guard-btn')).toBeNull();
  });
});

describe('removeButton', () => {
  beforeEach(setup);

  it('removes badge from DOM', () => {
    injectButton(chatgpt, () => {});
    removeButton(chatgpt.inputSelector);
    expect(document.getElementById('atenna-guard-btn')).toBeNull();
  });

  it('removes data-atenna-injected from container', () => {
    injectButton(chatgpt, () => {});
    removeButton(chatgpt.inputSelector);
    expect(document.getElementById('parent')!.hasAttribute('data-atenna-injected')).toBe(false);
  });

  it('cleans up scroll and resize listeners', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    injectButton(chatgpt, () => {});
    removeButton(chatgpt.inputSelector);
    expect(removeSpy).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(disconnectMock).toHaveBeenCalled();
  });
});
