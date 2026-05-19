import { describe, it, expect, vi, beforeEach } from 'vitest';

const storage: Record<string, unknown> = {};
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: (key: string, cb: (r: Record<string, unknown>) => void) => cb({ [key]: storage[key] }),
      set: (obj: Record<string, unknown>, cb?: () => void) => { Object.assign(storage, obj); cb?.(); },
      remove: (key: string, cb?: () => void) => { delete storage[key]; cb?.(); },
    },
  },
});

describe('consumeProWelcome', () => {
  beforeEach(() => { Object.keys(storage).forEach(k => delete storage[k]); vi.resetModules(); });

  it('returns true once then false', async () => {
    const { setProWelcomeFlag, consumeProWelcome } = await import('../onboarding');
    await setProWelcomeFlag();
    expect(await consumeProWelcome()).toBe(true);
    expect(await consumeProWelcome()).toBe(false);
  });

  it('upgradedToPro=true always clears flag', async () => {
    const { setProWelcomeFlag, resolveWelcomeState, consumeProWelcome } = await import('../onboarding');
    await setProWelcomeFlag();
    const { showWelcome } = await resolveWelcomeState(true);
    expect(showWelcome).toBe(true);
    expect(await consumeProWelcome()).toBe(false);
  });
});
