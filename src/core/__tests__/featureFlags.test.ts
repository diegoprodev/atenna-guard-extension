import { describe, it, expect, vi, beforeEach } from 'vitest';

const storageMock: Record<string, unknown> = {};
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn((key: string, cb: (r: Record<string, unknown>) => void) => {
        cb({ [key]: storageMock[key] });
      }),
      set: vi.fn((obj: Record<string, unknown>, cb?: () => void) => {
        Object.assign(storageMock, obj);
        cb?.();
      }),
      remove: vi.fn((_key: string, cb?: () => void) => {
        cb?.();
      }),
    },
  },
});

describe('featureFlags', () => {
  beforeEach(() => {
    vi.resetModules();
    for (const k of Object.keys(storageMock)) delete storageMock[k];
  });

  it('getFlag retorna default quando nada foi setado', async () => {
    const { getFlag } = await import('../featureFlags');
    expect(await getFlag('MULTIMODAL_ENABLED')).toBe(false);
    expect(await getFlag('DOCUMENT_DLP_ENABLED')).toBe(true);
    expect(await getFlag('STRICT_DOCUMENT_MODE')).toBe(true);
  });

  it('getFlag retorna valor salvo via setFlag', async () => {
    const { getFlag, setFlag } = await import('../featureFlags');
    await setFlag('MULTIMODAL_ENABLED', true);
    expect(await getFlag('MULTIMODAL_ENABLED')).toBe(true);
  });

  it('getFlag retorna false para flag desconhecida', async () => {
    const { getFlag } = await import('../featureFlags');
    expect(await getFlag('UNKNOWN_FLAG')).toBe(false);
  });

  it('getFlag NÃO lê localStorage', async () => {
    const localStorageSpy = vi.spyOn(Storage.prototype, 'getItem');
    const { getFlag } = await import('../featureFlags');
    await getFlag('DOCUMENT_DLP_ENABLED');
    expect(localStorageSpy).not.toHaveBeenCalled();
    localStorageSpy.mockRestore();
  });
});
