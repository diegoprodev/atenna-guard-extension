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

  it('timeout rejeita a Promise se o refresh travar', async () => {
    vi.resetModules();
    const { withRefreshLock } = await import('../refreshLock');

    let rejectHanging!: (reason?: unknown) => void;
    const hanging = new Promise<never>((_, reject) => { rejectHanging = reject; });
    hanging.catch(() => {}); // suppress unhandled rejection

    const resultPromise = withRefreshLock(() => hanging, 50);
    await expect(resultPromise).rejects.toThrow('refresh_timeout');
    rejectHanging(new Error('cleanup'));
  });

  it('após timeout, próximo caller pode iniciar novo refresh', async () => {
    vi.resetModules();
    const { withRefreshLock } = await import('../refreshLock');

    let rejectHanging!: (reason?: unknown) => void;
    const hanging = new Promise<never>((_, reject) => { rejectHanging = reject; });
    hanging.catch(() => {}); // suppress unhandled rejection

    const p1 = withRefreshLock(() => hanging, 50);
    await expect(p1).rejects.toThrow('refresh_timeout');
    rejectHanging(new Error('cleanup'));

    const refresh2 = vi.fn().mockResolvedValue('new-token');
    const result = await withRefreshLock(refresh2, 1000);
    expect(result).toBe('new-token');
  });
});
