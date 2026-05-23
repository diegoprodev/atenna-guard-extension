/**
 * Stress tests for bffGoogleLogin() — verifies robustness under edge cases,
 * rapid sequential calls, and adversarial inputs. Replaces need for manual validation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { E } from '../../core/errors';

const EXTENSION_ID = 'stresstest00000000000000000000000';
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
  token: 'bff-token-stress',
  user_id: 'stress-user-id',
  email: 'stress@gmail.com',
  plan: 'free',
  expires_at: 9999999999,
};

function mockFlow(url: string | undefined) {
  (chrome.identity.launchWebAuthFlow as ReturnType<typeof vi.fn>).mockImplementation(
    (_: unknown, cb: (u: string | undefined) => void) => cb(url),
  );
}

function mockSuccess(code = 'valid-code') {
  mockFlow(`${REDIRECT_URI}?code=${code}`);
  fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => SESSION });
}

describe('bffGoogleLogin() — Stress & Edge Cases', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── Adversarial redirect URLs ────────────────────────────────────────────────

  it('STRESS-01: rejects redirect with empty code param (?code=)', async () => {
    mockFlow(`${REDIRECT_URI}?code=`);
    await expect(bffGoogleLogin()).rejects.toMatchObject({ code: E.NETWORK });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('STRESS-02: rejects redirect with only fragment (no query params)', async () => {
    mockFlow(`${REDIRECT_URI}#access_token=jwt`);
    await expect(bffGoogleLogin()).rejects.toMatchObject({ code: E.NETWORK });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('STRESS-03: rejects malformed redirect URL (not a valid URL)', async () => {
    mockFlow('not-a-url-at-all');
    await expect(bffGoogleLogin()).rejects.toMatchObject({ code: E.NETWORK });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('STRESS-04: rejects redirect with error param (user denied)', async () => {
    mockFlow(`${REDIRECT_URI}?error=access_denied&error_description=User+denied`);
    await expect(bffGoogleLogin()).rejects.toMatchObject({ code: E.NETWORK });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('STRESS-05: rejects empty string redirect', async () => {
    mockFlow('');
    await expect(bffGoogleLogin()).rejects.toMatchObject({ code: E.NETWORK });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ── BFF response edge cases ──────────────────────────────────────────────────

  it('STRESS-06: throws E.INVALID_CREDENTIALS on 401 (invalid/expired code)', async () => {
    mockFlow(`${REDIRECT_URI}?code=expired`);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: 'invalid_or_expired_code' }) });
    await expect(bffGoogleLogin()).rejects.toMatchObject({ code: E.INVALID_CREDENTIALS });
  });

  it('STRESS-07: throws E.INVALID_CREDENTIALS on 400', async () => {
    mockFlow(`${REDIRECT_URI}?code=bad`);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}) });
    await expect(bffGoogleLogin()).rejects.toMatchObject({ code: E.INVALID_CREDENTIALS });
  });

  it('STRESS-08: throws E.RATE_LIMIT on 429', async () => {
    mockFlow(`${REDIRECT_URI}?code=code`);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) });
    await expect(bffGoogleLogin()).rejects.toMatchObject({ code: E.RATE_LIMIT });
  });

  it('STRESS-09: throws E.SERVER on 502 (gateway error)', async () => {
    mockFlow(`${REDIRECT_URI}?code=code`);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) });
    await expect(bffGoogleLogin()).rejects.toMatchObject({ code: E.SERVER });
  });

  it('STRESS-10: throws E.SERVER on 503 (service unavailable)', async () => {
    mockFlow(`${REDIRECT_URI}?code=code`);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    await expect(bffGoogleLogin()).rejects.toMatchObject({ code: E.SERVER });
  });

  // ── Network reliability ──────────────────────────────────────────────────────

  it('STRESS-11: throws E.NETWORK on network timeout (AbortError)', async () => {
    mockFlow(`${REDIRECT_URI}?code=code`);
    fetchMock.mockRejectedValueOnce(new DOMException('The operation was aborted', 'AbortError'));
    await expect(bffGoogleLogin()).rejects.toMatchObject({ code: E.NETWORK });
  });

  it('STRESS-12: throws E.NETWORK on DNS failure', async () => {
    mockFlow(`${REDIRECT_URI}?code=code`);
    fetchMock.mockRejectedValueOnce(new TypeError('net::ERR_NAME_NOT_RESOLVED'));
    await expect(bffGoogleLogin()).rejects.toMatchObject({ code: E.NETWORK });
  });

  // ── Rapid sequential calls ───────────────────────────────────────────────────

  it('STRESS-13: handles 10 sequential calls — each gets its own session', async () => {
    const results = [];
    for (let i = 0; i < 10; i++) {
      vi.clearAllMocks();
      const sess = { ...SESSION, token: `token-${i}`, user_id: `user-${i}` };
      mockFlow(`${REDIRECT_URI}?code=code-${i}`);
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => sess });
      const result = await bffGoogleLogin();
      results.push(result.token);
    }
    // Each call produced a unique token
    const unique = new Set(results);
    expect(unique.size).toBe(10);
  });

  // ── setSession never called on failure ──────────────────────────────────────

  it('STRESS-14: setSession NOT called when OAuth window cancelled', async () => {
    mockFlow(undefined);
    await expect(bffGoogleLogin()).rejects.toBeDefined();
    expect(sessionManager.setSession).not.toHaveBeenCalled();
  });

  it('STRESS-15: setSession NOT called when BFF returns 500', async () => {
    mockFlow(`${REDIRECT_URI}?code=code`);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(bffGoogleLogin()).rejects.toBeDefined();
    expect(sessionManager.setSession).not.toHaveBeenCalled();
  });

  // ── Security: redirect_uri must match what was sent to Supabase ─────────────

  it('STRESS-16: redirect_uri sent to BFF matches chrome.runtime.id-based URI', async () => {
    mockFlow(`${REDIRECT_URI}?code=mycode`);
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => SESSION });
    await bffGoogleLogin();
    const callBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(callBody.redirect_uri).toBe(REDIRECT_URI);
    expect(callBody.redirect_uri).toContain(EXTENSION_ID);
  });

  it('STRESS-17: auth URL contains encoded redirect_to with chromiumapp.org domain', async () => {
    mockFlow(`${REDIRECT_URI}?code=code`);
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => SESSION });
    await bffGoogleLogin();
    const flowCall = (chrome.identity.launchWebAuthFlow as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(flowCall.url).toContain('chromiumapp.org');
    expect(flowCall.url).toContain('redirect_to');
  });

  // ── Happy path completeness ──────────────────────────────────────────────────

  it('STRESS-18: successful login stores complete Session shape', async () => {
    mockSuccess();
    const result = await bffGoogleLogin();
    expect(result).toMatchObject({
      token: expect.any(String),
      user_id: expect.any(String),
      email: expect.any(String),
      plan: expect.any(String),
      expires_at: expect.any(Number),
    });
    expect(result.token.length).toBeGreaterThan(0);
  });

  it('STRESS-19: code with special URL characters is extracted correctly', async () => {
    const weirdCode = 'abc-def_ghi.jkl~mno';
    mockFlow(`${REDIRECT_URI}?code=${encodeURIComponent(weirdCode)}`);
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => SESSION });
    await bffGoogleLogin();
    const callBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(callBody.code).toBe(weirdCode);
  });

  it('STRESS-20: launchWebAuthFlow receives interactive:true (non-silent)', async () => {
    mockSuccess();
    await bffGoogleLogin();
    const flowOptions = (chrome.identity.launchWebAuthFlow as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(flowOptions.interactive).toBe(true);
  });
});
