import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getUsage, incrementUsage, isAtLimit, MONTHLY_LIMIT } from './usageCounter';

let store: Record<string, unknown> = {};

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn().mockImplementation((key: string, cb: (r: Record<string, unknown>) => void) => {
        cb({ [key]: store[key] });
      }),
      set: vi.fn().mockImplementation((data: Record<string, unknown>, cb?: () => void) => {
        Object.assign(store, data);
        cb?.();
      }),
    },
  },
});

describe('usageCounter', () => {
  beforeEach(() => { store = {}; });

  it('returns count=0 on first use', async () => {
    const usage = await getUsage();
    expect(usage.count).toBe(0);
  });

  it('sets resetDate ~30 days from now on first use', async () => {
    const before = Date.now();
    const usage = await getUsage();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(usage.resetDate).toBeGreaterThanOrEqual(before + thirtyDays - 500);
  });

  it('returns persisted count on second call', async () => {
    await getUsage();
    await incrementUsage();
    const usage = await getUsage();
    expect(usage.count).toBe(1);
  });

  it('incrementUsage increases count by 1', async () => {
    const u1 = await incrementUsage();
    expect(u1.count).toBe(1);
    const u2 = await incrementUsage();
    expect(u2.count).toBe(2);
  });

  it('isAtLimit returns false when under limit', async () => {
    const usage = await getUsage();
    expect(isAtLimit(usage)).toBe(false);
  });

  it('isAtLimit returns true at limit', () => {
    expect(isAtLimit({ count: MONTHLY_LIMIT, resetDate: Date.now() + 1000 })).toBe(true);
  });

  it('isAtLimit returns true above limit', () => {
    expect(isAtLimit({ count: MONTHLY_LIMIT + 5, resetDate: Date.now() + 1000 })).toBe(true);
  });

  it('resets count when resetDate has passed', async () => {
    store['atenna_usage'] = { count: 12, resetDate: Date.now() - 1000 };
    const usage = await getUsage();
    expect(usage.count).toBe(0);
    expect(usage.resetDate).toBeGreaterThan(Date.now());
  });

  it('MONTHLY_LIMIT is 15', () => {
    expect(MONTHLY_LIMIT).toBe(15);
  });
});
