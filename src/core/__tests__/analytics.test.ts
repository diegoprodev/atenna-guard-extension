import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const isPro = vi.fn(() => false);
vi.mock('../planManager', () => ({
  isPro: isPro,
}));

describe('getExtensionVersion', () => {
  let getManifestMock: any;
  let sendMessageMock: any;

  beforeEach(() => {
    getManifestMock = vi.fn(() => ({ version: '2.0.0' }));
    sendMessageMock = vi.fn();

    vi.stubGlobal('chrome', {
      runtime: {
        getManifest: getManifestMock,
        sendMessage: sendMessageMock,
      },
      storage: {
        local: {
          get: vi.fn((key: string, cb: (r: Record<string, unknown>) => void) => {
            cb({});
          }),
          set: vi.fn((obj: Record<string, unknown>, cb?: () => void) => {
            cb?.();
          }),
        },
        session: {
          get: vi.fn((key: string, cb: (r: Record<string, unknown>) => void) => {
            cb({});
          }),
          set: vi.fn((obj: Record<string, unknown>, cb?: () => void) => {
            cb?.();
          }),
        },
      },
    });

    vi.resetModules();
    isPro.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should return version from manifest when available', async () => {
    const { trackEvent } = await import('../analytics');
    await trackEvent('app_opened');

    expect(getManifestMock).toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalled();
    const call = sendMessageMock.mock.calls[0][0];
    expect(call.payload.extension_version).toBe('2.0.0');
  });

  it('should return fallback version when manifest access fails', async () => {
    getManifestMock.mockImplementationOnce(() => {
      throw new Error('Manifest not available');
    });

    const { trackEvent } = await import('../analytics');
    await trackEvent('app_opened');

    expect(sendMessageMock).toHaveBeenCalled();
    const call = sendMessageMock.mock.calls[0][0];
    expect(call.payload.extension_version).toBe('1.0.0');
  });

  it('should return fallback when manifest.version is undefined', async () => {
    getManifestMock.mockReturnValueOnce({ version: undefined });

    const { trackEvent } = await import('../analytics');
    await trackEvent('app_opened');

    expect(sendMessageMock).toHaveBeenCalled();
    const call = sendMessageMock.mock.calls[0][0];
    expect(call.payload.extension_version).toBe('1.0.0');
  });
});
