import { describe, it, expect, vi } from 'vitest';

vi.stubGlobal('chrome', {
  storage: { local: { get: vi.fn((_, cb: (r: Record<string, unknown>) => void) => cb({})), set: vi.fn((_, cb: () => void) => cb()) } },
  runtime: { id: 'test-id' },
});

describe('attachImageInterceptor', () => {
  it('does not throw when called with non-existent selector', async () => {
    vi.resetModules();
    const { attachImageInterceptor } = await import('../imageInterceptor');
    expect(() => attachImageInterceptor('#nonexistent-element')).not.toThrow();
  });

  it('does not throw when called with existing element', async () => {
    vi.resetModules();
    const { attachImageInterceptor } = await import('../imageInterceptor');
    const el = document.createElement('div');
    el.id = 'test-container';
    document.body.appendChild(el);
    expect(() => attachImageInterceptor('#test-container')).not.toThrow();
    document.body.removeChild(el);
  });
});
