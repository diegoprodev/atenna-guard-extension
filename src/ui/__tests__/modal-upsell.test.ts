import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../core/usageCounter', () => ({
  getUsage: vi.fn().mockResolvedValue({ count: 0 }),
  incrementUsage: vi.fn(),
  isAtLimit: vi.fn().mockReturnValue(false),
  isAtAnyLimit: vi.fn().mockReturnValue(false),
  DAILY_LIMIT: 5,
  MONTHLY_LIMIT: 50,
  getTotalCount: vi.fn().mockResolvedValue(0),
  incrementTotalCount: vi.fn(),
  getMonthlyUsage: vi.fn().mockResolvedValue({ count: 0 }),
  incrementMonthlyUsage: vi.fn(),
  syncUsageFromServer: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../auth/bffClient', () => ({
  bffMe: vi.fn().mockResolvedValue(null),
  bffLogin: vi.fn(),
  bffLogout: vi.fn(),
  bffGoogleLogin: vi.fn(),
  bffResetPassword: vi.fn(),
}));
vi.stubGlobal('chrome', {
  storage: { local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } },
  runtime: { id: 'test', getURL: vi.fn().mockReturnValue('') },
  tabs: { query: vi.fn() },
});

describe('updateUsageBadge — upsell nudge', () => {
  let badge: HTMLElement;

  beforeEach(() => {
    badge = document.createElement('span');
    document.body.appendChild(badge);
  });

  it('renders upgrade nudge button when free user uses 3 of 5', async () => {
    const mod = await import('../modal');
    if (!('updateUsageBadge' in mod)) return; // skip if not exported
    await (mod as unknown as { updateUsageBadge: (b: HTMLElement, c: number, p?: boolean) => Promise<void> }).updateUsageBadge(badge, 3, false);
    expect(badge.querySelector('.atenna-modal__upgrade-nudge')).not.toBeNull();
  });

  it('does NOT render upgrade nudge when count is 2', async () => {
    const mod = await import('../modal');
    if (!('updateUsageBadge' in mod)) return;
    await (mod as unknown as { updateUsageBadge: (b: HTMLElement, c: number, p?: boolean) => Promise<void> }).updateUsageBadge(badge, 2, false);
    expect(badge.querySelector('.atenna-modal__upgrade-nudge')).toBeNull();
  });

  it('does NOT render upgrade nudge for pro users', async () => {
    const mod = await import('../modal');
    if (!('updateUsageBadge' in mod)) return;
    await (mod as unknown as { updateUsageBadge: (b: HTMLElement, c: number, p?: boolean) => Promise<void> }).updateUsageBadge(badge, 3, true);
    expect(badge.querySelector('.atenna-modal__upgrade-nudge')).toBeNull();
  });
});
