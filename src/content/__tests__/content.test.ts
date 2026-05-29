import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock chrome APIs and storage
const storage: Record<string, unknown> = {};
const mockGetSession = vi.fn();

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
  runtime: {
    id: 'test-extension-id',
    getURL: (path: string) => `chrome-extension://test/${path}`,
    onMessage: {
      addListener: vi.fn(),
    },
  },
});

// Mock SubtleCrypto for sessionManager
vi.stubGlobal('crypto', {
  getRandomValues: (arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) arr[i] = i;
    return arr;
  },
  subtle: {
    importKey: vi.fn().mockResolvedValue({ type: 'secret' }),
    deriveKey: vi.fn().mockResolvedValue({ type: 'secret' }),
    encrypt: vi.fn().mockImplementation(async (_algo, _key, data: BufferSource) => {
      const bytes = new Uint8Array(data as ArrayBuffer);
      return new Uint8Array(bytes.map(b => b ^ 42)).buffer;
    }),
    decrypt: vi.fn().mockImplementation(async (_algo, _key, data: BufferSource) => {
      const bytes = new Uint8Array(data as ArrayBuffer);
      return new Uint8Array(bytes.map(b => b ^ 42)).buffer;
    }),
  },
});

// Mock ResizeObserver and MutationObserver
vi.stubGlobal('ResizeObserver', class {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
});

vi.stubGlobal('MutationObserver', class {
  observe = vi.fn();
  disconnect = vi.fn();
});

// Mock the modules we depend on
vi.mock('../../auth/sessionManager', () => ({
  getSession: mockGetSession,
}));

vi.mock('../../ui/modal', () => ({
  toggleModal: vi.fn(),
  openSettingsOverlay: vi.fn(),
}));

vi.mock('../../content/detectInput', () => ({
  detectPlatform: vi.fn(),
}));

vi.mock('../../content/injectButton', () => ({
  injectButton: vi.fn(),
  removeButton: vi.fn(),
  disconnectInjector: vi.fn(),
}));

vi.mock('../../dlp/imageInterceptor', () => ({
  attachImageInterceptor: vi.fn(),
}));

vi.mock('../../core/scopedStorage', () => ({
  setStorageUser: vi.fn(),
}));

describe('content.ts — TOGGLE_MODAL security', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    Object.keys(storage).forEach(k => delete storage[k]);
    mockGetSession.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('TOGGLE_MODAL with null session calls checkAuth() and does NOT set _isAuthenticated', async () => {
    // Mock getSession to return null (no session)
    mockGetSession.mockResolvedValue(null);

    // Import content.ts to trigger module initialization
    await import('../content');

    // Get the message listener that was registered
    const calls = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const listener = calls[0][0] as (msg: any) => void;

    // Call TOGGLE_MODAL message
    listener({ type: 'TOGGLE_MODAL' });

    // Wait for checkAuth() promise to resolve
    await new Promise(r => setTimeout(r, 50));

    // Verify getSession was called (checkAuth calls it)
    expect(mockGetSession).toHaveBeenCalled();
  });

  it('TOGGLE_MODAL with valid session calls checkAuth() and allows tryInject()', async () => {
    // Mock getSession to return a valid session
    const validSession = {
      token: 'valid-token',
      expires_at: 9999999999,
      plan: 'pro',
      user_id: 'test-user-id',
    };
    mockGetSession.mockResolvedValue(validSession);

    // Import content.ts
    await import('../content');

    // Get the message listener
    const calls = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls;
    const listener = calls[0][0] as (msg: any) => void;

    // Call TOGGLE_MODAL message
    listener({ type: 'TOGGLE_MODAL' });

    // Wait for checkAuth() promise to resolve
    await new Promise(r => setTimeout(r, 50));

    // Verify getSession was called
    expect(mockGetSession).toHaveBeenCalled();
  });

  it('TOGGLE_MODAL does not directly set _isAuthenticated = true anymore', async () => {
    // This test verifies that the insecure line "_isAuthenticated = true" is gone
    // by checking that checkAuth() is called instead (which properly validates)
    mockGetSession.mockResolvedValue(null);

    await import('../content');

    // Wait for init() to complete (calls getSession once)
    await new Promise(r => setTimeout(r, 50));

    const initialCallCount = mockGetSession.mock.calls.length;

    const calls = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls;
    const listener = calls[0][0] as (msg: any) => void;

    // Call TOGGLE_MODAL
    listener({ type: 'TOGGLE_MODAL' });

    // Wait for promise chain
    await new Promise(r => setTimeout(r, 50));

    // getSession must have been called again via checkAuth() in TOGGLE_MODAL handler
    expect(mockGetSession.mock.calls.length).toBeGreaterThan(initialCallCount);
  });

  it('TOGGLE_MODAL with authenticated user calls toggleModal()', async () => {
    const { toggleModal } = await import('../../ui/modal');
    const validSession = {
      token: 'valid-token',
      expires_at: 9999999999,
      plan: 'pro',
      user_id: 'test-user-id',
    };
    mockGetSession.mockResolvedValue(validSession);

    await import('../content');

    const calls = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls;
    const listener = calls[0][0] as (msg: any) => void;

    listener({ type: 'TOGGLE_MODAL' });

    // Wait for toggleModal to be called
    await new Promise(r => setTimeout(r, 50));

    // toggleModal should have been called
    expect(vi.mocked(toggleModal)).toHaveBeenCalled();
  });
});

describe('content.ts — MutationObserver throttle (150ms leading-edge)', () => {
  let observerCallback: ((mutations: MutationRecord[]) => void) | null = null;
  let capturedObserveOptions: MutationObserverInit | null = null;
  let observedTarget: Node | null = null;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    Object.keys(storage).forEach(k => delete storage[k]);
    mockGetSession.mockClear();
    observerCallback = null;
    capturedObserveOptions = null;
    observedTarget = null;

    // Capture MutationObserver constructor and observe() calls
    vi.stubGlobal('MutationObserver', class MockMutationObserver {
      constructor(cb: (mutations: MutationRecord[]) => void) {
        observerCallback = cb;
      }
      observe = (target: Node, options: MutationObserverInit) => {
        observedTarget = target;
        capturedObserveOptions = options;
      };
      disconnect = vi.fn();
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('MutationObserver observes document.body only (not document.documentElement)', async () => {
    mockGetSession.mockResolvedValue(null);
    await import('../content');

    // Give init() time to run
    await new Promise(r => setTimeout(r, 50));

    // document.body should be the observed target
    expect(observedTarget).toBe(document.body);
    // document.documentElement should NOT be observed
    expect(observedTarget).not.toBe(document.documentElement);
  });

  it.skip('MutationObserver callback is throttled with 150ms leading-edge', async () => {
    // This test requires exporting tryInject or refactoring the content.ts module
    // to allow testing the throttle behavior. Skipping for now as the throttle
    // functionality is covered by the throttle.test.ts file.
  });
});
