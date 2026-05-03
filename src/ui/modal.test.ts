import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toggleModal } from './modal';

// Stub chrome.runtime for content script context
vi.stubGlobal('chrome', { runtime: { getURL: (p: string) => `chrome-extension://test/${p}` } });

// Stub navigator.clipboard
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
  configurable: true,
});

describe('toggleModal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(
      { backgroundColor: 'rgb(255, 255, 255)' } as CSSStyleDeclaration
    );
  });

  it('opens overlay on first call', () => {
    toggleModal();
    expect(document.getElementById('atenna-modal-overlay')).not.toBeNull();
  });

  it('closes overlay on second call (toggle off)', () => {
    toggleModal();
    toggleModal();
    expect(document.getElementById('atenna-modal-overlay')).toBeNull();
  });

  it('renders modal with class atenna-modal', () => {
    toggleModal();
    expect(document.querySelector('.atenna-modal')).not.toBeNull();
  });

  it('renders 3 prompt cards', () => {
    toggleModal();
    expect(document.querySelectorAll('.atenna-modal__card').length).toBe(3);
  });

  it('renders Copiar and USAR buttons for each card', () => {
    toggleModal();
    expect(document.querySelectorAll('.atenna-modal__btn--copy').length).toBe(3);
    expect(document.querySelectorAll('.atenna-modal__btn--use').length).toBe(3);
  });

  it('shows empty-input placeholder when no platform input present', () => {
    toggleModal();
    expect(document.querySelector('.atenna-modal__input-empty')).not.toBeNull();
  });

  it('shows current input text when platform input is present', () => {
    const ta = document.createElement('textarea');
    ta.id = 'prompt-textarea';
    ta.value = 'minha pergunta de teste';
    document.body.appendChild(ta);
    toggleModal();
    expect(document.querySelector('.atenna-modal__input-preview')!.textContent).toContain('minha pergunta');
  });

  it('close button removes overlay', () => {
    toggleModal();
    const closeBtn = document.querySelector('.atenna-modal__close') as HTMLButtonElement;
    closeBtn.click();
    expect(document.getElementById('atenna-modal-overlay')).toBeNull();
  });

  it('clicking overlay backdrop closes modal', () => {
    toggleModal();
    const overlay = document.getElementById('atenna-modal-overlay')!;
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('atenna-modal-overlay')).toBeNull();
  });

  it('ESC key closes modal', () => {
    toggleModal();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('atenna-modal-overlay')).toBeNull();
  });

  it('adds atenna-modal--dark when body is dark', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(
      { backgroundColor: 'rgb(20, 20, 30)' } as CSSStyleDeclaration
    );
    toggleModal();
    expect(document.querySelector('.atenna-modal--dark')).not.toBeNull();
  });

  it('escapes HTML in user input to prevent XSS', () => {
    const ta = document.createElement('textarea');
    ta.id = 'prompt-textarea';
    ta.value = '<script>alert(1)</script>';
    document.body.appendChild(ta);
    toggleModal();
    const preview = document.querySelector('.atenna-modal__input-preview')!;
    expect(preview.innerHTML).not.toContain('<script>');
    expect(preview.textContent).toContain('alert(1)');
  });

  it('USAR button sets input text and closes modal', () => {
    const ta = document.createElement('textarea');
    ta.id = 'prompt-textarea';
    ta.value = 'texto original';
    document.body.appendChild(ta);
    toggleModal();
    const useBtn = document.querySelector<HTMLButtonElement>('[data-use="0"]')!;
    useBtn.click();
    expect(document.getElementById('atenna-modal-overlay')).toBeNull();
    expect(ta.value).not.toBe('texto original');
  });

  it('Copiar button calls clipboard.writeText', async () => {
    const ta = document.createElement('textarea');
    ta.id = 'prompt-textarea';
    ta.value = 'test';
    document.body.appendChild(ta);
    toggleModal();
    const copyBtn = document.querySelector<HTMLButtonElement>('[data-copy="0"]')!;
    copyBtn.click();
    await Promise.resolve();
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });
});
