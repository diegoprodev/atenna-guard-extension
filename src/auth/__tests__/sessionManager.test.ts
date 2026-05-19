import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock chrome APIs
const storage: Record<string, unknown> = {};
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: (keys: string | string[], cb: (r: Record<string, unknown>) => void) => {
        const keyArr = Array.isArray(keys) ? keys : [keys];
        cb(Object.fromEntries(keyArr.map(k => [k, storage[k]])));
      },
      set: (obj: Record<string, unknown>, cb?: () => void) => {
        Object.assign(storage, obj);
        cb?.();
      },
      remove: (keys: string | string[], cb?: () => void) => {
        const keyArr = Array.isArray(keys) ? keys : [keys];
        keyArr.forEach(k => delete storage[k]);
        cb?.();
      },
    },
  },
  runtime: { id: 'test-extension-id-abc123' },
});

// Mock SubtleCrypto with pass-through (XOR with key for testing)
const mockKey = { type: 'secret' };
vi.stubGlobal('crypto', {
  getRandomValues: (arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) arr[i] = i;
    return arr;
  },
  subtle: {
    importKey: vi.fn().mockResolvedValue(mockKey),
    deriveKey: vi.fn().mockResolvedValue(mockKey),
    encrypt: vi.fn().mockImplementation(async (_algo, _key, data: BufferSource) => {
      const bytes = new Uint8Array(data as ArrayBuffer);
      // Simple XOR with 42 for testing
      return new Uint8Array(bytes.map(b => b ^ 42)).buffer;
    }),
    decrypt: vi.fn().mockImplementation(async (_algo, _key, data: BufferSource) => {
      const bytes = new Uint8Array(data as ArrayBuffer);
      return new Uint8Array(bytes.map(b => b ^ 42)).buffer;
    }),
  },
});

import {
  setSession,
  getSession,
  clearSession,
  _setPendingRefresh,
  Session,
} from '../sessionManager';

describe('sessionManager', () => {
  beforeEach(() => {
    Object.keys(storage).forEach(k => delete storage[k]);
    // Reset pending refresh state
    _setPendingRefresh(null as unknown as () => Promise<Session>);
  });

  it('stores token in encrypted form (not plaintext)', async () => {
    await setSession({ token: 'my-opaque-token', expires_at: 9999999999, plan: 'free' });
    const raw = JSON.stringify(storage['atenna_session']);
    // The stored value must not contain the plaintext token
    expect(raw).not.toContain('my-opaque-token');
  });

  it('retrieves and decrypts session correctly', async () => {
    await setSession({ token: 'opaque-uuid-token', expires_at: 9999999999, plan: 'pro' });
    const s = await getSession();
    expect(s?.token).toBe('opaque-uuid-token');
    expect(s?.plan).toBe('pro');
  });

  it('returns null if token is expired', async () => {
    await setSession({ token: 'tok', expires_at: 1000, plan: 'free' }); // past timestamp
    const s = await getSession();
    expect(s).toBeNull();
  });

  it('concurrent getSession calls share one refresh promise', async () => {
    // Store an expired session
    await setSession({ token: 'old', expires_at: 1000, plan: 'free' });

    const mockRefresh = vi.fn().mockResolvedValue({
      token: 'new-tok',
      expires_at: 9999999999,
      plan: 'free',
    });
    _setPendingRefresh(mockRefresh);

    await Promise.all([getSession(), getSession(), getSession()]);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});
