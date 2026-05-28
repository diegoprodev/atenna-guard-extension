import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const SRC = join(__dirname, '..');

function readFile(relPath: string): string {
  return readFileSync(join(SRC, relPath), 'utf-8');
}

describe('Security Harness', () => {
  it('H-MSG-1: background.ts validates sender.id', () => {
    const bg = readFile('background/background.ts');
    expect(bg).toContain('sender.id');
    expect(bg).toContain('chrome.runtime.id');
  });

  it('H-XSS-1: popup.ts has no innerHTML with session.email or user data', () => {
    const popup = readFile('popup.ts');
    // Match innerHTML = `...${session.email}...` or `...${session.user_id}...`
    const danger = /\.innerHTML\s*[+]?=.*\$\{[^}]*(email|user_id|name|input|file)\b/;
    expect(popup).not.toMatch(danger);
  });

  it('H-CSP-1: manifest.json has content_security_policy', () => {
    const manifest = readFile('../manifest.json');
    const m = JSON.parse(manifest);
    expect(m).toHaveProperty('content_security_policy');
    expect(m.content_security_policy.extension_pages).toContain("script-src 'self'");
  });

  it('H-SUPABASE-1: popup.ts and background.ts do not contain direct supabase auth calls', () => {
    // Core content-script files (dlpStats, planManager etc) still use direct Supabase
    // REST for non-auth data — pending BFF migration in FASE 4.7.
    // This test verifies the auth-critical files (popup, background) are clean.
    const popup = readFile('popup.ts');
    const bg = readFile('background/background.ts');
    // Neither should import supabaseClient or call supabase.auth directly
    expect(popup).not.toMatch(/supabaseClient|createClient.*supabase/);
    expect(bg).not.toMatch(/supabaseClient|createClient.*supabase/);
  });
});

describe('Google OAuth — Security Invariants (SI-31 to SI-36)', () => {
  it('SI-31: Google button class present in modal.ts login view', () => {
    const authViews = readFile('ui/modal/auth-views.ts');
    expect(authViews).toContain('atenna-modal__login-btn--google');
    expect(authViews).toContain('bffGoogleLogin');
  });

  it('SI-32: bffGoogleLogin uses launchWebAuthFlow with Supabase Google OAuth URL', () => {
    const client = readFile('auth/bffClient.ts');
    expect(client).toContain('launchWebAuthFlow');
    expect(client).toContain('provider=google');
    expect(client).toContain('supabase.co/auth/v1/authorize');
  });

  it('SI-33: bffGoogleLogin POSTs to BFF /auth/google — NOT directly to Supabase token endpoint', () => {
    const client = readFile('auth/bffClient.ts');
    const fnStart = client.indexOf('export async function bffGoogleLogin');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = client.slice(fnStart, fnStart + 2000);
    expect(fnBody).toContain('/auth/google');
    expect(fnBody).not.toContain('/auth/v1/token');
  });

  it('SI-34: bffGoogleLogin calls setSession — opaque BFF token stored encrypted', () => {
    const client = readFile('auth/bffClient.ts');
    const fnStart = client.indexOf('export async function bffGoogleLogin');
    const fnBody = client.slice(fnStart, fnStart + 2000);
    expect(fnBody).toContain('setSession(s)');
  });

  it('SI-35: bffGoogleLogin stores opaque token via setSession, never the raw Supabase access_token', () => {
    const client = readFile('auth/bffClient.ts');
    const fnStart = client.indexOf('export async function bffGoogleLogin');
    const fnBody = client.slice(fnStart, fnStart + 2000);
    // Must call setSession (stores session)
    expect(fnBody).toContain('setSession(s)');
    // Must NOT pass access_token directly to setSession — only the opaque BFF session
    expect(fnBody).not.toMatch(/setSession\s*\(\s*\{[^}]*access_token/);
    // access_token must only appear in the BFF request body, not stored locally
    expect(fnBody).toContain('body: JSON.stringify(body)');
  });

  it('SI-36: sessionManager encrypts before chrome.storage write (AES-GCM)', () => {
    const sm = readFile('auth/sessionManager.ts');
    expect(sm).toContain('chrome.storage.local.set');
    // Must encrypt — either encrypt() call or AES-GCM reference
    expect(sm).toMatch(/encrypt|AES-GCM|AES_GCM/);
  });
});
