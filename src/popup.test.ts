import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('popup.ts doAction — signup confirmation screen', () => {
  it('shows email confirmation content after successful signup', () => {
    const src = fs.readFileSync('src/popup.ts', 'utf-8');
    expect(src).toContain('Verifique seu email');
    expect(src).toContain('mail.google.com');
    expect(src).toContain('Abrir Gmail');
    expect(src).toContain('Voltar ao login');
    expect(src).toContain('ap-back-to-login');
  });
});

describe('popup.ts — no Copilot references', () => {
  it('SUPPORTED_HOSTS should not include copilot', () => {
    const src = fs.readFileSync('src/popup.ts', 'utf-8');
    expect(src).not.toContain('copilot.microsoft.com');
    expect(src).not.toContain("'Copilot'");
  });
});
