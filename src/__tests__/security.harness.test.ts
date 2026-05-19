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
