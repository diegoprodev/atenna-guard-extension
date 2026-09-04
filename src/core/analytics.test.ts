import { describe, it, expect, vi, beforeEach } from 'vitest';

// FASE 10.9 B12 — getOrCreateSessionId não pode gerar "Unchecked runtime.lastError"
// quando chrome.storage.session não é acessível (content script).

describe('analytics.getOrCreateSessionId — B12 storage.session', () => {
  beforeEach(() => { vi.resetModules(); });

  it('cai pro fallback em memória quando storage.session dá lastError', async () => {
    vi.stubGlobal('chrome', {
      runtime: { lastError: { message: 'Access to storage is not allowed from this context.' } },
      storage: {
        session: {
          get: (_k: string, cb: (r: Record<string, unknown>) => void) => cb({}),
          set: (_d: unknown, cb: () => void) => cb(),
        },
        local: { get: (_k: string, cb: (r: Record<string, unknown>) => void) => cb({}) },
      },
    });
    const { getOrCreateSessionId } = await import('./analytics');
    const a = await getOrCreateSessionId();
    const b = await getOrCreateSessionId();
    expect(a).toMatch(/^sess_/);
    expect(a).toBe(b); // estável dentro do mesmo contexto
  });

  it('usa storage.session quando acessível', async () => {
    const store: Record<string, unknown> = {};
    vi.stubGlobal('chrome', {
      runtime: { lastError: undefined },
      storage: {
        session: {
          get: (k: string, cb: (r: Record<string, unknown>) => void) => cb({ [k]: store[k] }),
          set: (d: Record<string, unknown>, cb: () => void) => { Object.assign(store, d); cb(); },
        },
        local: { get: (_k: string, cb: (r: Record<string, unknown>) => void) => cb({}) },
      },
    });
    const { getOrCreateSessionId } = await import('./analytics');
    const a = await getOrCreateSessionId();
    const b = await getOrCreateSessionId();
    expect(a).toBe(b);
  });
});
