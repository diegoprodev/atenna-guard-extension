import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toggleModal } from './modal';

vi.stubGlobal('chrome', { runtime: { getURL: (p: string) => `chrome-extension://test/${p}` } });

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

  it('renders copy icon and USAR buttons for each card', () => {
    toggleModal();
    expect(document.querySelectorAll('.atenna-modal__btn-copy').length).toBe(3);
    expect(document.querySelectorAll('.atenna-modal__btn-use').length).toBe(3);
  });

  it('header has sticky toggle with two tabs', () => {
    toggleModal();
    expect(document.querySelectorAll('.atenna-modal__tab').length).toBe(2);
  });

  it('"Criar Prompt" tab is active by default', () => {
    toggleModal();
    const active = document.querySelector('.atenna-modal__tab--active');
    expect(active?.textContent).toContain('Criar Prompt');
  });

  it('clicking "Editar Texto" tab shows edit view', () => {
    toggleModal();
    const editTab = Array.from(document.querySelectorAll<HTMLButtonElement>('.atenna-modal__tab'))
      .find(t => t.dataset.tab === 'edit')!;
    editTab.click();
    const editView = document.querySelector<HTMLElement>('[data-view="edit"]')!;
    expect(editView.classList.contains('atenna-modal__view--hidden')).toBe(false);
  });

  it('edit view contains a textarea', () => {
    toggleModal();
    const editTab = Array.from(document.querySelectorAll<HTMLButtonElement>('.atenna-modal__tab'))
      .find(t => t.dataset.tab === 'edit')!;
    editTab.click();
    expect(document.querySelector('.atenna-modal__editor')).not.toBeNull();
  });

  it('textarea pre-fills with current platform input', () => {
    const ta = document.createElement('textarea');
    ta.id = 'prompt-textarea';
    ta.value = 'minha pergunta original';
    document.body.appendChild(ta);
    toggleModal();
    const editTab = Array.from(document.querySelectorAll<HTMLButtonElement>('.atenna-modal__tab'))
      .find(t => t.dataset.tab === 'edit')!;
    editTab.click();
    const editor = document.querySelector<HTMLTextAreaElement>('.atenna-modal__editor')!;
    expect(editor.value).toContain('minha pergunta original');
  });

  it('Gerar Prompts button regenerates cards and returns to prompts view', () => {
    toggleModal();
    const editTab = Array.from(document.querySelectorAll<HTMLButtonElement>('.atenna-modal__tab'))
      .find(t => t.dataset.tab === 'edit')!;
    editTab.click();
    const editor = document.querySelector<HTMLTextAreaElement>('.atenna-modal__editor')!;
    editor.value = 'novo texto para gerar';
    document.querySelector<HTMLButtonElement>('.atenna-modal__regen')!.click();
    const activeTab = document.querySelector('.atenna-modal__tab--active');
    expect(activeTab?.textContent).toContain('Criar Prompt');
    expect(document.querySelectorAll('.atenna-modal__card').length).toBe(3);
  });

  it('close button removes overlay', () => {
    toggleModal();
    (document.querySelector('.atenna-modal__close') as HTMLButtonElement).click();
    expect(document.getElementById('atenna-modal-overlay')).toBeNull();
  });

  it('clicking backdrop closes modal', () => {
    toggleModal();
    document.getElementById('atenna-modal-overlay')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('atenna-modal-overlay')).toBeNull();
  });

  it('ESC closes modal', () => {
    toggleModal();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('atenna-modal-overlay')).toBeNull();
  });

  it('adds atenna-modal--dark when body is dark', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(
      { backgroundColor: 'rgb(15, 15, 15)' } as CSSStyleDeclaration
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
    const cards = document.querySelector('.atenna-modal__cards')!;
    expect(cards.innerHTML).not.toContain('<script>');
  });

  it('USAR button sets input text and closes modal', () => {
    const ta = document.createElement('textarea');
    ta.id = 'prompt-textarea';
    ta.value = 'texto original';
    document.body.appendChild(ta);
    toggleModal();
    document.querySelector<HTMLButtonElement>('[data-use="0"]')!.click();
    expect(document.getElementById('atenna-modal-overlay')).toBeNull();
    expect(ta.value).not.toBe('texto original');
  });

  it('Copiar button calls clipboard.writeText', async () => {
    const ta = document.createElement('textarea');
    ta.id = 'prompt-textarea';
    ta.value = 'test';
    document.body.appendChild(ta);
    toggleModal();
    document.querySelector<HTMLButtonElement>('[data-copy="0"]')!.click();
    await Promise.resolve();
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });
});
