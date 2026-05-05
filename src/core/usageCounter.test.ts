import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getUsage, incrementUsage, isAtLimit, DAILY_LIMIT,
  getTotalCount, incrementTotalCount,
} from './usageCounter';

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
      remove: vi.fn().mockImplementation((key: string, cb?: () => void) => {
        delete store[key];
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

  it('sets resetDate to midnight tonight on first use', async () => {
    const usage = await getUsage();
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    expect(usage.resetDate).toBeGreaterThan(Date.now());
    expect(usage.resetDate).toBeLessThanOrEqual(midnight.getTime() + 1000);
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
    expect(isAtLimit({ count: DAILY_LIMIT, resetDate: Date.now() + 1000 })).toBe(true);
  });

  it('isAtLimit returns true above limit', () => {
    expect(isAtLimit({ count: DAILY_LIMIT + 5, resetDate: Date.now() + 1000 })).toBe(true);
  });

  it('resets count when resetDate has passed', async () => {
    store['atenna_usage'] = { count: 8, resetDate: Date.now() - 1000 };
    const usage = await getUsage();
    expect(usage.count).toBe(0);
    expect(usage.resetDate).toBeGreaterThan(Date.now());
  });

  it('DAILY_LIMIT is 10', () => {
    expect(DAILY_LIMIT).toBe(10);
  });
});

describe('totalCount', () => {
  beforeEach(() => { store = {}; });

  it('starts at 0', async () => {
    expect(await getTotalCount()).toBe(0);
  });

  it('increments independently from daily usage', async () => {
    await incrementTotalCount();
    await incrementTotalCount();
    expect(await getTotalCount()).toBe(2);
  });

  it('persists across daily resets', async () => {
    store['atenna_usage'] = { count: 5, resetDate: Date.now() - 1 };
    await incrementTotalCount();
    await getUsage(); // triggers daily reset
    expect(await getTotalCount()).toBe(1); // total not reset
  });
});
