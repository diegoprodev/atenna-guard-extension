/**
 * BUG (relatado): após instalar, clicar no ícone da extensão SEM login →
 * aparece um skeleton e some (o popup fecha sozinho).
 *
 * Causa: `initPopup()` renderiza o skeleton, faz `await bffMe()`, e quando não há
 * sessão ele:
 *   - site suportado  → `chrome.tabs.sendMessage(OPEN_LOGIN_MODAL)` + `window.close()`
 *   - site qualquer   → `renderUnsupportedSiteMessage` (SEM opção de login)
 * `renderLogin()` existe no popup mas NUNCA é chamado nesse caminho.
 *
 * Este teste reproduz os dois cenários. Deve FALHAR antes do fix e passar depois.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const storage: Record<string, unknown> = {};
const mockBffMe = vi.fn();
let queryTabs: Array<{ id: number; url: string }> = [];
const sentMessages: Array<{ tabId: number; msg: unknown }> = [];

vi.mock('../auth/bffClient', () => ({
  bffMe: (...a: unknown[]) => mockBffMe(...a),
  bffLogin: vi.fn(),
  bffLogout: vi.fn(),
  bffResetPassword: vi.fn(),
  bffGoogleLogin: vi.fn(),
}));
vi.mock('../core/observability', () => ({ initObservability: vi.fn() }));
vi.mock('../core/auth', () => ({ signUpWithPassword: vi.fn() }));
vi.mock('../ui/modal', () => ({ openSettingsOverlay: vi.fn() }));

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: (k: string | string[], cb: (r: Record<string, unknown>) => void) => {
        const arr = Array.isArray(k) ? k : [k];
        cb(Object.fromEntries(arr.map(x => [x, storage[x]])));
      },
      set: (o: Record<string, unknown>, cb?: () => void) => { Object.assign(storage, o); cb?.(); },
    },
  },
  runtime: { id: 'test', lastError: undefined, getURL: (p: string) => `chrome-extension://test/${p}`,
    sendMessage: vi.fn((_m: unknown, cb?: () => void) => cb?.()) },
  tabs: {
    query: (_q: unknown, cb: (t: unknown[]) => void) => cb(queryTabs),
    create: vi.fn(),
    sendMessage: vi.fn((tabId: number, msg: unknown, cb?: () => void) => { sentMessages.push({ tabId, msg }); cb?.(); }),
  },
});

const closeSpy = vi.fn();
vi.stubGlobal('window', Object.assign(globalThis.window ?? {}, { close: closeSpy }));

async function run() {
  document.body.innerHTML = '<div id="atenna-popup"></div>';
  vi.resetModules();
  const { initPopup } = await import('../popup');
  await initPopup();
  return document.getElementById('atenna-popup')!;
}

function hasLoginUI(el: HTMLElement): boolean {
  const t = el.textContent?.toLowerCase() ?? '';
  return el.querySelector('input[type="password"]') !== null
      || t.includes('entrar') || t.includes('criar conta') || t.includes('continuar com google');
}

describe('popup — usuário NÃO logado clica no ícone', () => {
  beforeEach(() => {
    for (const k of Object.keys(storage)) delete storage[k];
    sentMessages.length = 0;
    closeSpy.mockClear();
    mockBffMe.mockResolvedValue(null); // sem sessão
  });

  it('site suportado (chatgpt): NÃO deve fechar o popup sem oferecer login', async () => {
    queryTabs = [{ id: 5, url: 'https://chatgpt.com/' }];
    const el = await run();
    expect(hasLoginUI(el)).toBe(true);      // deve mostrar login NO popup
    expect(closeSpy).not.toHaveBeenCalled(); // não fecha sozinho
  });

  it('site qualquer (google): deve oferecer login, não só "site não suportado"', async () => {
    queryTabs = [{ id: 9, url: 'https://www.google.com/' }];
    const el = await run();
    expect(hasLoginUI(el)).toBe(true);
  });
});
