import { describe, it, expect, vi, beforeEach } from 'vitest';

// FASE P-ZT — signOut() tinha que apagar os dados escritos sob a conta que
// está saindo. `userScopedKeys` existia desde a FASE 10 mas nunca era chamada:
// numa máquina compartilhada, dado de um usuário que já deslogou ficava
// legível pra sempre em chrome.storage.local (ex.: DevTools da extensão).

const store: Record<string, unknown> = {};

vi.stubGlobal('chrome', {
  storage: {
    local: {
      remove: vi.fn((keys: string | string[], cb: () => void) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
        cb();
      }),
    },
  },
});

vi.mock('../auth/bffClient', () => ({
  bffLogin: vi.fn(),
  bffLogout: vi.fn().mockResolvedValue(undefined),
  bffResetPassword: vi.fn(),
  bffMe: vi.fn(),
}));
vi.mock('../auth/sessionManager', () => ({
  getSession: vi.fn(),
  setSession: vi.fn(),
  clearSession: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
  vi.clearAllMocks();
});

describe('signOut() — apaga dado escopado do usuário que sai (FASE P-ZT)', () => {
  it('remove atenna_history/usage/plano etc do uid que estava logado', async () => {
    const { setStorageUser } = await import('./scopedStorage');
    const { signOut } = await import('./auth');

    setStorageUser('user-A');
    store['atenna_history__user-A'] = ['pergunta secreta do usuario A'];
    store['atenna_usage__user-A'] = { count: 3 };
    store['atenna_plan__user-A'] = { type: 'pro' };
    // dado de OUTRO usuário na mesma máquina — não pode ser tocado
    store['atenna_history__user-B'] = ['segredo do usuario B'];

    await signOut();

    expect(store['atenna_history__user-A']).toBeUndefined();
    expect(store['atenna_usage__user-A']).toBeUndefined();
    expect(store['atenna_plan__user-A']).toBeUndefined();
    expect(store['atenna_history__user-B']).toEqual(['segredo do usuario B']); // intocado
  });

  it('sem usuário logado (uid null) não quebra — só limpa o JWT legado', async () => {
    const { setStorageUser } = await import('./scopedStorage');
    const { signOut } = await import('./auth');
    setStorageUser(null);
    await expect(signOut()).resolves.toBeUndefined();
  });
});
