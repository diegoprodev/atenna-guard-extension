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

  it('timeout de 10s rejeita a Promise se o refresh travar', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const { withRefreshLock } = await import('../refreshLock');

    const hanging = new Promise<never>(() => { /* never resolves */ });
    const resultPromise = withRefreshLock(() => hanging);

    vi.advanceTimersByTime(10_001);
    await vi.runAllTimersAsync();

    await expect(resultPromise).rejects.toThrow('refresh_timeout');
    vi.useRealTimers();
  });

  it('após timeout, próximo caller pode iniciar novo refresh', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const { withRefreshLock } = await import('../refreshLock');

    const hanging = new Promise<never>(() => {});
    const p1 = withRefreshLock(() => hanging);
    vi.advanceTimersByTime(10_001);
    await vi.runAllTimersAsync();
    await expect(p1).rejects.toThrow('refresh_timeout');

    const refresh2 = vi.fn().mockResolvedValue('new-token');
    const result = await withRefreshLock(refresh2);
    expect(result).toBe('new-token');
    vi.useRealTimers();
  });
});
