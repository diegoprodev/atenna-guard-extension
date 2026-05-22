import { describe, it, expect, vi, beforeEach } from 'vitest';
import { E } from '../../core/errors';

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
const REDIRECT_URI = `https://${EXTENSION_ID}.chromiumapp.org/`;

vi.stubGlobal('chrome', {
  runtime: { id: EXTENSION_ID },
  identity: { launchWebAuthFlow: vi.fn() },
});

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

vi.mock('../sessionManager', () => ({
  getSession: vi.fn().mockResolvedValue(null),
  setSession: vi.fn().mockResolvedValue(undefined),
  clearSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../refreshLock', () => ({
  withRefreshLock: vi.fn(),
}));

import { bffGoogleLogin } from '../bffClient';
import * as sessionManager from '../sessionManager';

const SESSION = {
  token: 'bff-opaque-token',
  user_id: 'uuid-123',
  email: 'user@gmail.com',
  plan: 'free',
  expires_at: 9999999999,
};

function mockFlow(url: string | undefined) {
  (chrome.identity.launchWebAuthFlow as ReturnType<typeof vi.fn>).mockImplementation(
    (_: unknown, cb: (u: string | undefined) => void) => cb(url),
  );
}

describe('bffGoogleLogin()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls launchWebAuthFlow with Supabase Google OAuth URL', async () => {
    mockFlow(`${REDIRECT_URI}?code=abc123`);
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => SESSION });
    await bffGoogleLogin();
    expect(chrome.identity.launchWebAuthFlow).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringContaining('provider=google'), interactive: true }),
      expect.any(Function),
    );
  });

  it('POSTs to /auth/google with code and redirect_uri', async () => {
    mockFlow(`${REDIRECT_URI}?code=mycode`);
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => SESSION });
    await bffGoogleLogin();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/auth/google'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ code: 'mycode', redirect_uri: REDIRECT_URI }),
      }),
    );
  });

  it('calls setSession and returns session', async () => {
    mockFlow(`${REDIRECT_URI}?code=xyz`);
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => SESSION });
    const result = await bffGoogleLogin();
    expect(sessionManager.setSession).toHaveBeenCalledWith(SESSION);
    expect(result).toEqual(SESSION);
  });

  it('throws E.NETWORK when user cancels (undefined redirect)', async () => {
    mockFlow(undefined);
    await expect(bffGoogleLogin()).rejects.toMatchObject({ code: E.NETWORK });
  });

  it('throws E.NETWORK when redirect has no code', async () => {
    mockFlow(`${REDIRECT_URI}?error=access_denied`);
    await expect(bffGoogleLogin()).rejects.toMatchObject({ code: E.NETWORK });
  });

  it('throws E.NETWORK when fetch throws', async () => {
    mockFlow(`${REDIRECT_URI}?code=x`);
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(bffGoogleLogin()).rejects.toMatchObject({ code: E.NETWORK });
  });

  it('throws E.SERVER when BFF returns 500', async () => {
    mockFlow(`${REDIRECT_URI}?code=x`);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(bffGoogleLogin()).rejects.toMatchObject({ code: E.SERVER });
  });
});
