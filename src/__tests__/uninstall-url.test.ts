import { describe, it, expect, vi } from 'vitest';

vi.mock('../core/observability', () => ({ initObservability: vi.fn() }));
vi.mock('../auth/sessionManager', () => ({ getSession: vi.fn().mockResolvedValue(null) }));

describe('background — feedback de desinstalação', () => {
  it('registra setUninstallURL apontando pro /desinstalado do backend', async () => {
    const setUninstallURL = vi.fn();
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'x',
        onInstalled: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn() },
        setUninstallURL,
        getURL: (p: string) => p,
        lastError: undefined,
      },
      tabs: { create: vi.fn(), query: vi.fn(), sendMessage: vi.fn() },
    });

    await import('../background/background');

    expect(setUninstallURL).toHaveBeenCalledWith('https://api.atennaia.com.br/desinstalado');
  });
});
