import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStorage = { get: vi.fn((_, cb) => cb({})), set: vi.fn((_, cb) => cb?.()) };
vi.stubGlobal('chrome', {
  storage: { local: mockStorage },
  runtime: { id: 'test-ext-id', getURL: (p: string) => `chrome-extension://test/${p}` },
});

describe('disconnectInjector', () => {
  beforeEach(() => { vi.resetModules(); });

  it('exporta função disconnectInjector', async () => {
    const mod = await import('../injectButton');
    expect(typeof mod.disconnectInjector).toBe('function');
  });

  it('disconnectInjector() não lança se chamado sem injectButton ter rodado', async () => {
    const { disconnectInjector } = await import('../injectButton');
    expect(() => disconnectInjector()).not.toThrow();
  });

  it('disconnectInjector() é idempotente — segunda chamada não lança', async () => {
    vi.resetModules();
    const { disconnectInjector } = await import('../injectButton');
    // First call — currentCleanup is undefined, no-op
    disconnectInjector();
    // Second call — currentCleanup is still undefined, must not throw
    expect(() => disconnectInjector()).not.toThrow();
  });
});
