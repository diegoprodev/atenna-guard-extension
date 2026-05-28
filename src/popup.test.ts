import { describe, it, expect, vi, beforeEach } from 'vitest';
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

describe('popup.ts — personalized error messages', () => {
  it('has specific error mappings for email_not_found, wrong_password, email_not_confirmed', () => {
    const src = fs.readFileSync('src/popup.ts', 'utf-8');
    expect(src).toContain('email_not_found');
    expect(src).toContain('Senha incorreta');
    expect(src).toContain('email_not_confirmed');
  });
});

describe('popup.ts — auto-focus on error', () => {
  it('source contains focus() calls in validation block', () => {
    const src = fs.readFileSync('src/popup.ts', 'utf-8');
    expect(src).toContain('emailEl.focus()');
    expect(src).toContain('passEl.focus()');
  });
});

const storageData: Record<string, unknown> = {};

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn((key: string | string[], cb: (r: Record<string, unknown>) => void) => {
        const k = Array.isArray(key) ? key[0] : key;
        cb({ [k]: storageData[k] });
      }),
      set: vi.fn((data: Record<string, unknown>, cb: () => void) => {
        Object.assign(storageData, data);
        cb();
      }),
      remove: vi.fn((_: unknown, cb: () => void) => cb()),
    },
  },
  runtime: { id: 'test', getURL: vi.fn().mockReturnValue('icons/icon128.png'), lastError: undefined },
  tabs: { query: vi.fn((_, cb: (tabs: unknown[]) => void) => cb([])) },
});

vi.mock('./auth/bffClient', () => ({
  bffMe: vi.fn().mockResolvedValue({ email: 'test@test.com', plan: 'free' }),
  bffLogin: vi.fn(),
  bffLogout: vi.fn(),
  bffGoogleLogin: vi.fn(),
  bffResetPassword: vi.fn(),
}));
vi.mock('./ui/modal', () => ({ openSettingsOverlay: vi.fn() }));
vi.mock('./core/auth', () => ({ signUpWithPassword: vi.fn() }));

beforeEach(() => {
  Object.keys(storageData).forEach(k => delete storageData[k]);
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="atenna-popup"></div>';
});

describe('First-run onboarding', () => {
  it('shows 3-slide onboarding when atenna_onboarded is not set', async () => {
    vi.resetModules();
    vi.mock('./auth/bffClient', () => ({
      bffMe: vi.fn().mockResolvedValue({ email: 'test@test.com', plan: 'free' }),
    }));
    vi.mock('./ui/modal', () => ({ openSettingsOverlay: vi.fn() }));
    vi.mock('./core/auth', () => ({ signUpWithPassword: vi.fn() }));
    const { initPopup } = await import('./popup');
    await initPopup();
    const container = document.getElementById('atenna-popup')!;
    expect(container.querySelectorAll('.ap-onboarding__slide').length).toBe(3);
  });

  it('skips onboarding when atenna_onboarded is true', async () => {
    storageData['atenna_onboarded'] = true;
    vi.resetModules();
    vi.mock('./auth/bffClient', () => ({
      bffMe: vi.fn().mockResolvedValue({ email: 'test@test.com', plan: 'free' }),
    }));
    vi.mock('./ui/modal', () => ({ openSettingsOverlay: vi.fn() }));
    vi.mock('./core/auth', () => ({ signUpWithPassword: vi.fn() }));
    const { initPopup } = await import('./popup');
    await initPopup();
    const container = document.getElementById('atenna-popup')!;
    expect(container.querySelectorAll('.ap-onboarding__slide').length).toBe(0);
  });

  it('sets atenna_onboarded and calls onDone after clicking CTA', async () => {
    vi.resetModules();
    vi.mock('./auth/bffClient', () => ({
      bffMe: vi.fn().mockResolvedValue({ email: 'test@test.com', plan: 'free' }),
    }));
    vi.mock('./ui/modal', () => ({ openSettingsOverlay: vi.fn() }));
    vi.mock('./core/auth', () => ({ signUpWithPassword: vi.fn() }));
    const { initPopup } = await import('./popup');
    await initPopup();
    const btn = document.querySelector('#ap-onboarding-cta') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    btn!.click();
    await new Promise(r => setTimeout(r, 20));
    expect(storageData['atenna_onboarded']).toBe(true);
  });
});
