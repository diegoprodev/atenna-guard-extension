import { describe, it, expect, vi, beforeEach } from 'vitest';

// FASE 10.9.7 — quando a sessão expira (401 + refresh falha), o bffFetch
// derruba a sessão. Antes ele SÓ tirava `atenna_session` — o dado escopado
// no usuário (histórico/uso/plano) ficava pra sempre no chrome.storage.local.
// Mesmo vazamento que o signOut já cobria, mas por outro caminho (expiração
// automática em vez de logout manual) — o F11 do E2E pegou isso como flake.

const removed: string[][] = [];

vi.stubGlobal('chrome', {
  storage: {
    local: {
      remove: vi.fn((keys: string | string[], cb?: () => void) => {
        removed.push(Array.isArray(keys) ? keys : [keys]);
        cb?.();
      }),
    },
  },
});

const FAKE_SESSION = { token: 'opaque-abc', user_id: 'user-X', email: 'x@a.ai', expires_at: 9999999999 };

vi.mock('./sessionManager', () => ({
  getSession: vi.fn().mockResolvedValue(FAKE_SESSION),
  setSession: vi.fn(),
  clearSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./refreshLock', () => ({
  withRefreshLock: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

beforeEach(() => {
  removed.length = 0;
  vi.clearAllMocks();
});

describe('bffFetch — 401 + refresh falho purga o dado escopado do usuário', () => {
  it('purga atenna_history/usage/plano__user-X quando a sessão expira', async () => {
    const { setStorageUser } = await import('../core/scopedStorage');
    const { bffFetch } = await import('./bffClient');

    setStorageUser('user-X');

    // 1ª chamada (/auth/usage) → 401 · refresh (/auth/refresh) → 401 (falha)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 401, json: async () => ({}),
    }));

    await expect(bffFetch('/auth/usage')).rejects.toThrow();

    const allRemoved = removed.flat();
    expect(allRemoved).toContain('atenna_history__user-X');
    expect(allRemoved).toContain('atenna_usage__user-X');
    expect(allRemoved).toContain('atenna_plan__user-X');
    expect(allRemoved).toContain('atenna_last_gen_sig__user-X');
  });
});
