import { describe, it, expect, beforeEach, vi } from 'vitest';
import { togglePanel } from './panel';

describe('togglePanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('creates #atenna-panel on first call', () => {
    togglePanel('ChatGPT');
    expect(document.getElementById('atenna-panel')).not.toBeNull();
  });

  it('removes #atenna-panel on second call (toggle off)', () => {
    togglePanel('ChatGPT');
    togglePanel('ChatGPT');
    expect(document.getElementById('atenna-panel')).toBeNull();
  });

  it('panel has class atenna-panel', () => {
    togglePanel('Claude');
    expect(document.querySelector('.atenna-panel')).not.toBeNull();
  });

  it('panel contains the platform name', () => {
    togglePanel('Gemini');
    expect(document.getElementById('atenna-panel')!.textContent).toContain('Gemini');
  });

  it('panel contains "Atenna ativo"', () => {
    togglePanel('ChatGPT');
    expect(document.getElementById('atenna-panel')!.textContent).toContain('Atenna ativo');
  });

  it('close button removes the panel', () => {
    togglePanel('ChatGPT');
    const closeBtn = document.querySelector('.atenna-panel__close') as HTMLButtonElement;
    closeBtn.click();
    expect(document.getElementById('atenna-panel')).toBeNull();
  });

  it('escapes HTML in platform name to prevent XSS', () => {
    togglePanel('<script>alert(1)</script>');
    const panel = document.getElementById('atenna-panel')!;
    expect(panel.innerHTML).not.toContain('<script>');
    expect(panel.textContent).toContain('alert(1)');
  });

  it('adds atenna-panel--dark when body background is dark', () => {
    // Simulate dark platform background
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(
      { backgroundColor: 'rgb(20, 20, 30)' } as CSSStyleDeclaration
    );
    togglePanel('ChatGPT');
    expect(document.getElementById('atenna-panel')!.classList.contains('atenna-panel--dark')).toBe(true);
    vi.restoreAllMocks();
  });

  it('does not add atenna-panel--dark when body background is light', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(
      { backgroundColor: 'rgb(255, 255, 255)' } as CSSStyleDeclaration
    );
    togglePanel('ChatGPT');
    expect(document.getElementById('atenna-panel')!.classList.contains('atenna-panel--dark')).toBe(false);
    vi.restoreAllMocks();
  });
});
