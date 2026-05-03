import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { toggleModal, fetchPrompts } from './modal';

// ── Shared state ───────────────────────────────────────────

let chromeStore: Record<string, unknown> = {};

const FETCH_OK = {
  ok: true,
  json: () => Promise.resolve({
    direct:     'prompt direto gerado pela IA',
    technical:  'prompt técnico gerado pela IA',
    structured: 'prompt estruturado gerado pela IA',
  }),
};

function stubChrome() {
  vi.stubGlobal('chrome', {
    runtime: { getURL: (p: string) => `chrome-extension://test/${p}` },
    storage: {
      local: {
        get: vi.fn().mockImplementation((key: string, cb: (r: Record<string, unknown>) => void) => {
          cb({ [key]: chromeStore[key] });
        }),
        set: vi.fn().mockImplementation((data: Record<string, unknown>, cb?: () => void) => {
          Object.assign(chromeStore, data);
          cb?.();
        }),
      },
    },
  });
}

// ── Helper: flush the full async flow ─────────────────────
// runFlow: renderLoading (sync) → getUsage (Promise) → fetch (Promise)
//          → renderSuccess (setTimeout 500ms) → incrementUsage (Promise) → renderPrompts.
async function waitForFlow(): Promise<void> {
  // Drain getUsage + fetchPrompts microtask chains (interleaved with for-loop)
  for (let i = 0; i < 15; i++) await Promise.resolve();
  // Fire the 500ms renderSuccess timer
  vi.advanceTimersByTime(600);
  // Drain incrementUsage chain + renderPrompts
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

// ── Suite ─────────────────────────────────────────────────

describe('toggleModal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    chromeStore = {};
    // Re-stub everything: vi.restoreAllMocks() resets vi.fn() implementations
    stubChrome();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(FETCH_OK));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(
      { backgroundColor: 'rgb(255, 255, 255)' } as CSSStyleDeclaration
    );
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Open / close ────────────────────────────────────────

  it('opens overlay on first call', () => {
    toggleModal();
    expect(document.getElementById('atenna-modal-overlay')).not.toBeNull();
  });

  it('closes overlay on second call', () => {
    toggleModal();
    toggleModal();
    expect(document.getElementById('atenna-modal-overlay')).toBeNull();
  });

  it('does not open duplicate overlays', () => {
    toggleModal();
    toggleModal();
    toggleModal();
    expect(document.querySelectorAll('#atenna-modal-overlay').length).toBe(1);
  });

  it('close button removes overlay', () => {
    toggleModal();
    (document.querySelector('.atenna-modal__close') as HTMLButtonElement).click();
    expect(document.getElementById('atenna-modal-overlay')).toBeNull();
  });

  it('ESC closes modal', () => {
    toggleModal();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('atenna-modal-overlay')).toBeNull();
  });

  it('clicking backdrop closes modal', () => {
    toggleModal();
    document.getElementById('atenna-modal-overlay')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('atenna-modal-overlay')).toBeNull();
  });

  // ── Header structure ─────────────────────────────────────

  it('renders header with 2 tabs and usage badge', () => {
    toggleModal();
    expect(document.querySelectorAll('.atenna-modal__tab').length).toBe(2);
    expect(document.querySelector('.atenna-modal__usage')).not.toBeNull();
  });

  it('"Criar Prompt" tab is active by default', () => {
    toggleModal();
    const active = document.querySelector<HTMLButtonElement>('.atenna-modal__tab--active');
    expect(active?.dataset.tab).toBe('prompts');
  });

  it('"Meu Texto" is first tab, "Criar Prompt" is second', () => {
    toggleModal();
    const tabs = document.querySelectorAll<HTMLButtonElement>('.atenna-modal__tab');
    expect(tabs[0].dataset.tab).toBe('edit');
    expect(tabs[1].dataset.tab).toBe('prompts');
  });

  // ── Dark mode ────────────────────────────────────────────

  it('no dark class on light background', () => {
    toggleModal();
    expect(document.querySelector('.atenna-modal--dark')).toBeNull();
  });

  it('adds dark class on dark background', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(
      { backgroundColor: 'rgb(15, 15, 15)' } as CSSStyleDeclaration
    );
    toggleModal();
    expect(document.querySelector('.atenna-modal--dark')).not.toBeNull();
  });

  // ── Loading (sync, visible immediately) ──────────────────

  it('shows spinner immediately on open', () => {
    toggleModal();
    expect(document.querySelector('.atenna-modal__spinner')).not.toBeNull();
  });

  it('shows loading message immediately', () => {
    toggleModal();
    expect(document.querySelector('.atenna-modal__loading-msg')).not.toBeNull();
  });

  // ── Async flow: loading → success → prompts ──────────────

  it('renders 3 cards after flow completes', async () => {
    toggleModal();
    await waitForFlow();
    expect(document.querySelectorAll('.atenna-modal__card').length).toBe(3);
  });

  it('each card has readonly textarea', async () => {
    toggleModal();
    await waitForFlow();
    const textareas = document.querySelectorAll<HTMLTextAreaElement>('.atenna-modal__card-textarea');
    expect(textareas.length).toBe(3);
    textareas.forEach(ta => expect(ta.readOnly).toBe(true));
  });

  it('each card has copy icon and USAR button', async () => {
    toggleModal();
    await waitForFlow();
    expect(document.querySelectorAll('.atenna-modal__btn-copy').length).toBe(3);
    expect(document.querySelectorAll('.atenna-modal__btn-use').length).toBe(3);
  });

  it('cards are filled with backend-generated text', async () => {
    toggleModal();
    await waitForFlow();
    const ta = document.querySelector<HTMLTextAreaElement>('.atenna-modal__card-textarea')!;
    expect(ta.value).toContain('gerado pela IA');
  });

  // ── Usage counter ────────────────────────────────────────

  it('usage badge shows X/15 format after generation', async () => {
    toggleModal();
    await waitForFlow();
    const badge = document.querySelector('.atenna-modal__usage')!;
    expect(badge.textContent).toMatch(/^\d+\/15$/);
  });

  it('usage count is 1 after first generation', async () => {
    toggleModal();
    await waitForFlow();
    expect(document.querySelector('.atenna-modal__usage')!.textContent).toBe('1/15');
  });

  // ── Limit reached ────────────────────────────────────────

  it('shows limit UI when count is at 15', async () => {
    chromeStore['atenna_usage'] = {
      count: 15,
      resetDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
    };
    toggleModal();
    // renderLoading is sync; getUsage resolves in ~3 turns; renderLimitReached is sync
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(document.querySelector('.atenna-modal__limit-icon')).not.toBeNull();
    expect(document.querySelector('.atenna-modal__loading-msg')!.textContent)
      .toContain('Limite mensal atingido');
  });

  it('usage badge shows danger class at limit', async () => {
    chromeStore['atenna_usage'] = {
      count: 15,
      resetDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
    };
    toggleModal();
    for (let i = 0; i < 12; i++) await Promise.resolve();
    const badge = document.querySelector('.atenna-modal__usage')!;
    expect(badge.classList.contains('atenna-modal__usage--danger')).toBe(true);
  });

  // ── USAR button ──────────────────────────────────────────

  it('USAR fills platform input and closes modal', async () => {
    const ta = document.createElement('textarea');
    ta.id = 'prompt-textarea';
    ta.value = 'texto original';
    document.body.appendChild(ta);
    toggleModal();
    await waitForFlow();
    document.querySelector<HTMLButtonElement>('.atenna-modal__btn-use')!.click();
    expect(document.getElementById('atenna-modal-overlay')).toBeNull();
    expect(ta.value).not.toBe('texto original');
    expect(ta.value.length).toBeGreaterThan(0);
  });

  // ── Copy button ──────────────────────────────────────────

  it('Copiar calls clipboard.writeText', async () => {
    toggleModal();
    await waitForFlow();
    document.querySelector<HTMLButtonElement>('.atenna-modal__btn-copy')!.click();
    await Promise.resolve();
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });

  // ── Edit tab ─────────────────────────────────────────────

  it('"Meu Texto" tab shows edit view', () => {
    toggleModal();
    Array.from(document.querySelectorAll<HTMLButtonElement>('.atenna-modal__tab'))
      .find(t => t.dataset.tab === 'edit')!.click();
    expect(
      document.querySelector<HTMLElement>('[data-view="edit"]')!
        .classList.contains('atenna-modal__view--hidden')
    ).toBe(false);
  });

  it('editor textarea is pre-filled with platform input text', () => {
    const ta = document.createElement('textarea');
    ta.id = 'prompt-textarea';
    ta.value = 'texto do usuário no chat';
    document.body.appendChild(ta);
    toggleModal();
    expect(
      document.querySelector<HTMLTextAreaElement>('.atenna-modal__editor')!.value
    ).toBe('texto do usuário no chat');
  });

  // ── Security ─────────────────────────────────────────────

  it('XSS: user input never appears raw as innerHTML in cards', async () => {
    const ta = document.createElement('textarea');
    ta.id = 'prompt-textarea';
    ta.value = '<script>alert(1)</script>';
    document.body.appendChild(ta);
    toggleModal();
    await waitForFlow();
    document.querySelectorAll<HTMLTextAreaElement>('.atenna-modal__card-textarea')
      .forEach(el => expect(el.innerHTML).not.toContain('<script>'));
  });
});

// ── fetchPrompts unit tests ────────────────────────────────

describe('fetchPrompts', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(FETCH_OK));
  });

  it('returns backend data on success', async () => {
    const result = await fetchPrompts('plano de natação');
    expect(result.direct).toBe('prompt direto gerado pela IA');
  });

  it('returns fallback when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const result = await fetchPrompts('meu texto');
    expect(result.direct).toContain('meu texto');
    expect(result.technical).toContain('meu texto');
    expect(result.structured).toContain('meu texto');
  });

  it('returns fallback when response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const result = await fetchPrompts('texto');
    expect(result.direct).toContain('texto');
  });
});
