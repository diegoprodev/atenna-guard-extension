import { describe, it, expect, beforeEach } from 'vitest';
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

  it('panel contains "Atenna Guard ativo"', () => {
    togglePanel('ChatGPT');
    expect(document.getElementById('atenna-panel')!.textContent).toContain('Atenna Guard ativo');
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
});
