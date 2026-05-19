import { describe, it, expect, vi } from 'vitest';

describe('withRefreshLock', () => {
  it('concurrent callers share one pending refresh', async () => {
    vi.resetModules();
    const { withRefreshLock } = await import('../refreshLock');
    const refresh = vi.fn().mockImplementation(
      () => new Promise<string>(r => setTimeout(() => r('token'), 20))
    );
    const results = await Promise.all([
      withRefreshLock(refresh),
      withRefreshLock(refresh),
      withRefreshLock(refresh),
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(new Set(results).size).toBe(1);
  });

  it('sequential callers each trigger a refresh', async () => {
    vi.resetModules();
    const { withRefreshLock } = await import('../refreshLock');
    const refresh = vi.fn()
      .mockResolvedValueOnce('a')
      .mockResolvedValueOnce('b');
    expect(await withRefreshLock(refresh)).toBe('a');
    expect(await withRefreshLock(refresh)).toBe('b');
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
