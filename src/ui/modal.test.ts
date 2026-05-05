import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { toggleModal, fetchPrompts, clearPromptCache } from './modal';
import * as auth from '../core/auth';
import * as planManager from '../core/planManager';

// ── Shared state ───────────────────────────────────────────

let chromeStore: Record<string, unknown> = {};

const PROMPT_RESPONSE = {
  ok: true,
  data: {
    direct:     'prompt direto gerado pela IA',
    technical:  'prompt técnico gerado pela IA',
    structured: 'prompt estruturado gerado pela IA',
  },
};

function stubChrome(sendMsgResponse: unknown = PROMPT_RESPONSE) {
  // Default to a valid session so tests proceed past login screen
  // Valid JWT with sub claim for syncPlanFromSupabase: header.payload.signature
  const testJwtPayload = btoa(JSON.stringify({ sub: 'test-user-id', email: 'test@example.com' }));
  const testJwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${testJwtPayload}.test-signature`;
  const defaultSession = {
    access_token: testJwt,
    email: 'test@example.com',
    expires_at: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
  };
  if (!chromeStore['atenna_jwt']) {
    chromeStore['atenna_jwt'] = defaultSession;
  }

  vi.stubGlobal('chrome', {
    runtime: {
      getURL: (p: string) => `chrome-extension://test/${p}`,
      sendMessage: vi.fn().mockImplementation(
        (_msg: unknown, cb?: (r: unknown) => void) => { cb?.(sendMsgResponse); }
      ),
      lastError: undefined,
    },
    storage: {
      local: {
        get: vi.fn().mockImplementation((key: string, cb: (r: Record<string, unknown>) => void) => {
          cb({ [key]: chromeStore[key] });
        }),
        set: vi.fn().mockImplementation((data: Record<string, unknown>, cb?: () => void) => {
          Object.assign(chromeStore, data);
          cb?.();
        }),
        remove: vi.fn().mockImplementation((_key: string, cb?: () => void) => {
          cb?.();
        }),
      },
    },
  });
}

// Helper: add a platform textarea with text so auto-generation runs
function addTextarea(value = 'texto de teste') {
  const ta = document.createElement('textarea');
  ta.id = 'prompt-textarea';
  ta.value = value;
  document.body.appendChild(ta);
  return ta;
}

// ── Helper: flush the full async flow ─────────────────────
// Modal init: getActiveSession → syncPlanFromSupabase (dynamic import + fetch) → getUsage/isPro → runFlow
// runFlow: renderLoading → getUsage → sendMessage → renderSuccess (500ms) → incrementUsage → renderPrompts
async function waitForFlow(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
  vi.advanceTimersByTime(600);
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

// ── Suite ─────────────────────────────────────────────────

describe('toggleModal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    chromeStore = {};
    clearPromptCache();
    stubChrome();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(
      { backgroundColor: 'rgb(255, 255, 255)' } as CSSStyleDeclaration
    );
    // Mock auth functions so tests skip the session check logic
    vi.spyOn(auth, 'getActiveSession').mockResolvedValue({
      access_token: 'test-token',
      email: 'test@example.com',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    vi.spyOn(planManager, 'syncPlanFromSupabase').mockResolvedValue(undefined);
    // Mock fetch for any other calls
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ plan: 'free' }],
    });
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

  // ── Tab labels and order ─────────────────────────────────

  it('"Criar Prompt" is first tab, "Meus Prompts" is second', () => {
    toggleModal();
    const tabs = document.querySelectorAll<HTMLButtonElement>('.atenna-modal__tab');
    expect(tabs[0].dataset.tab).toBe('edit');
    expect(tabs[0].textContent).toBe('Criar Prompt');
    expect(tabs[1].dataset.tab).toBe('prompts');
    expect(tabs[1].textContent).toBe('Meus Prompts');
  });

  it('"Criar Prompt" tab is active when input is empty', () => {
    toggleModal(); // no textarea in DOM
    const active = document.querySelector<HTMLButtonElement>('.atenna-modal__tab--active');
    expect(active?.dataset.tab).toBe('edit');
  });

  it('"Meus Prompts" tab is active when input has text', () => {
    addTextarea('algum texto');
    toggleModal();
    const active = document.querySelector<HTMLButtonElement>('.atenna-modal__tab--active');
    expect(active?.dataset.tab).toBe('prompts');
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

  // ── Empty input — no auto-generation ─────────────────────

  it('no spinner on open when input is empty', () => {
    toggleModal();
    expect(document.querySelector('.atenna-modal__spinner')).toBeNull();
  });

  it('shows spinner immediately when input has text', () => {
    addTextarea('algum texto');
    toggleModal();
    expect(document.querySelector('.atenna-modal__spinner')).not.toBeNull();
  });

  it('shows loading message immediately when input has text', () => {
    addTextarea('algum texto');
    toggleModal();
    expect(document.querySelector('.atenna-modal__loading-msg')).not.toBeNull();
  });

  it('no generation happens when input is empty', async () => {
    toggleModal();
    await waitForFlow();
    // No cards should appear
    expect(document.querySelectorAll('.atenna-modal__card').length).toBe(0);
    // ATENNA_FETCH should not have been called
    const fetchCalls = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls
      .filter(([msg]: [{ type?: string }]) => msg.type === 'ATENNA_FETCH');
    expect(fetchCalls.length).toBe(0);
  });

  // ── Async flow: loading → success → prompts ──────────────

  it('renders 3 cards after flow completes', async () => {
    addTextarea('algum texto');
    toggleModal();
    await waitForFlow();
    expect(document.querySelectorAll('.atenna-modal__card').length).toBe(3);
  });

  it('each card has readonly textarea', async () => {
    addTextarea('algum texto');
    toggleModal();
    await waitForFlow();
    const textareas = document.querySelectorAll<HTMLTextAreaElement>('.atenna-modal__card-textarea');
    expect(textareas.length).toBe(3);
    textareas.forEach(ta => expect(ta.readOnly).toBe(true));
  });

  it('each card has copy icon and USAR button', async () => {
    addTextarea('algum texto');
    toggleModal();
    await waitForFlow();
    expect(document.querySelectorAll('.atenna-modal__btn-copy').length).toBe(3);
    expect(document.querySelectorAll('.atenna-modal__btn-use').length).toBe(3);
  });

  it('cards are filled with backend-generated text', async () => {
    addTextarea('algum texto');
    toggleModal();
    await waitForFlow();
    const ta = document.querySelector<HTMLTextAreaElement>('.atenna-modal__card-textarea')!;
    expect(ta.value).toContain('gerado pela IA');
  });

  // ── Cache: no re-generation on reopen with same text ─────

  it('reopening with same text shows cached prompts without calling backend again', async () => {
    addTextarea('texto cacheado');
    toggleModal();
    await waitForFlow();
    // Count only ATENNA_FETCH calls (analytics ATENNA_TRACK calls are also present)
    const fetchCallsAfterFirst = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls
      .filter(([msg]: [{ type?: string }]) => msg.type === 'ATENNA_FETCH').length;

    // Close and reopen
    toggleModal();
    stubChrome(); // re-stub so we can track calls
    document.body.innerHTML = '';
    addTextarea('texto cacheado');
    toggleModal();
    // Cache hit renders after getUsage+isPro microtask ticks
    for (let i = 0; i < 8; i++) await Promise.resolve();

    const fetchCallsOnReopen = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls
      .filter(([msg]: [{ type?: string }]) => msg.type === 'ATENNA_FETCH').length;
    expect(fetchCallsOnReopen).toBe(0);
    expect(document.querySelectorAll('.atenna-modal__card').length).toBe(3);
    expect(fetchCallsAfterFirst).toBe(1);
  });

  // ── Usage counter ────────────────────────────────────────

  it('usage badge shows X/10 format after generation', async () => {
    addTextarea('algum texto');
    toggleModal();
    await waitForFlow();
    const badge = document.querySelector('.atenna-modal__usage')!;
    expect(badge.textContent).toMatch(/^\d+\/10$/);
  });

  it('usage count is 1 after first generation', async () => {
    addTextarea('algum texto');
    toggleModal();
    await waitForFlow();
    expect(document.querySelector('.atenna-modal__usage')!.textContent).toBe('1/10');
  });

  // ── Limit reached ────────────────────────────────────────

  it('shows limit UI when count is at 15', async () => {
    addTextarea('algum texto');
    chromeStore['atenna_usage'] = {
      count: 15,
      resetDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
    };
    toggleModal();
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(document.querySelector('.atenna-modal__limit-icon')).not.toBeNull();
    expect(document.querySelector('.atenna-modal__loading-msg')!.textContent)
      .toContain('Limite mensal atingido');
  });

  it('usage badge shows danger class at limit', async () => {
    addTextarea('algum texto');
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
    const ta = addTextarea('texto original');
    toggleModal();
    await waitForFlow();
    document.querySelector<HTMLButtonElement>('.atenna-modal__btn-use')!.click();
    expect(document.getElementById('atenna-modal-overlay')).toBeNull();
    expect(ta.value).not.toBe('texto original');
    expect(ta.value.length).toBeGreaterThan(0);
  });

  // ── Copy button ──────────────────────────────────────────

  it('Copiar calls clipboard.writeText', async () => {
    addTextarea('algum texto');
    toggleModal();
    await waitForFlow();
    document.querySelector<HTMLButtonElement>('.atenna-modal__btn-copy')!.click();
    await Promise.resolve();
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });

  // ── Edit tab (Criar Prompt) ───────────────────────────────

  it('"Criar Prompt" tab shows edit view when clicked', () => {
    addTextarea('algum texto');
    toggleModal();
    Array.from(document.querySelectorAll<HTMLButtonElement>('.atenna-modal__tab'))
      .find(t => t.dataset.tab === 'edit')!.click();
    expect(
      document.querySelector<HTMLElement>('[data-view="edit"]')!
        .classList.contains('atenna-modal__view--hidden')
    ).toBe(false);
  });

  it('editor textarea is pre-filled with platform input text', () => {
    addTextarea('texto do usuário no chat');
    toggleModal();
    expect(
      document.querySelector<HTMLTextAreaElement>('.atenna-modal__editor')!.value
    ).toBe('texto do usuário no chat');
  });

  it('Gerar button triggers flow and switches to Meus Prompts', async () => {
    toggleModal(); // empty input — Criar Prompt tab active
    const editor = document.querySelector<HTMLTextAreaElement>('.atenna-modal__editor')!;
    editor.value = 'meu texto para gerar';
    document.querySelector<HTMLButtonElement>('.atenna-modal__regen')!.click();
    const activeTab = document.querySelector<HTMLButtonElement>('.atenna-modal__tab--active');
    expect(activeTab?.dataset.tab).toBe('prompts');
    await waitForFlow();
    expect(document.querySelectorAll('.atenna-modal__card').length).toBe(3);
  });

  it('Gerar button with empty editor does nothing', () => {
    toggleModal();
    document.querySelector<HTMLButtonElement>('.atenna-modal__regen')!.click();
    // Should still be on edit tab (no switch)
    const activeTab = document.querySelector<HTMLButtonElement>('.atenna-modal__tab--active');
    expect(activeTab?.dataset.tab).toBe('edit');
  });

  // ── Security ─────────────────────────────────────────────

  it('XSS: user input never appears raw as innerHTML in cards', async () => {
    addTextarea('conteúdo malicioso <script>alert(1)</script> no prompt');
    toggleModal();
    await waitForFlow();
    document.querySelectorAll<HTMLTextAreaElement>('.atenna-modal__card-textarea')
      .forEach(el => expect(el.innerHTML).not.toContain('<script>'));
  });
});

// ── fetchPrompts unit tests ────────────────────────────────

describe('fetchPrompts', () => {
  beforeEach(() => {
    stubChrome();
  });

  it('returns backend data on success', async () => {
    const result = await fetchPrompts('plano de natação');
    expect(result.direct).toBe('prompt direto gerado pela IA');
  });

  it('returns fallback when sendMessage returns null', async () => {
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn().mockImplementation((_msg: unknown, cb: (r: unknown) => void) => { cb(null); }),
        lastError: { message: 'no connection' },
      },
    });
    const result = await fetchPrompts('meu texto');
    expect(result.direct).toContain('meu texto');
    expect(result.technical).toContain('meu texto');
    expect(result.structured).toContain('meu texto');
  });

  it('returns fallback when backend returns not ok', async () => {
    stubChrome({ ok: false, status: 503 });
    const result = await fetchPrompts('texto');
    expect(result.direct).toContain('texto');
  });
});
