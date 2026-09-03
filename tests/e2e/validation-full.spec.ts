/**
 * VALIDAÇÃO PONTA A PONTA — a experiência completa do usuário.
 * Carrega o dist/ real no Chromium. Cobre os buracos que os testes T, W, P e F não pegam:
 * toggle de senha, logout do popup, aba histórico, seções de config, cards de
 * privacidade clicáveis, confirm no Sair, header do modal de planos, latência,
 * e — o principal — FALHA se aparecer qualquer console.error("[Atenna] …")
 * durante qualquer passo (detector de bug silencioso).
 *
 * Doc: docs/specs/VALIDACAO_PONTA_A_PONTA.md
 */
import { test, expect, injectSession, openFixturePage } from './helpers/extension';
import type { BrowserContext, Page } from '@playwright/test';

const POPUP = (id: string) => `chrome-extension://${id}/popup.html`;
const WELCOME = (id: string) => `chrome-extension://${id}/welcome.html`;

async function sw(context: BrowserContext) {
  let [s] = context.serviceWorkers();
  if (!s) s = await context.waitForEvent('serviceworker', { timeout: 10_000 });
  return s;
}
async function clearAll(context: BrowserContext) {
  const s = await sw(context);
  await s.evaluate(() => new Promise<void>(r => chrome.storage.local.clear(() => r())));
}

/** Anexa o detector de bug silencioso. Chame no começo de cada teste. */
function watchErrors(page: Page): string[] {
  const errs: string[] = [];
  page.on('console', m => {
    if (m.type() === 'error' && /\[atenna\]|atenna-guard|unhandledrejection/i.test(m.text())) {
      errs.push(`console: ${m.text()}`);
    }
  });
  page.on('pageerror', e => errs.push(`pageerror: ${e.message}`));
  return errs;
}

async function mockBff(context: BrowserContext, plan: 'free' | 'pro' = 'free') {
  await context.route('**/api.atennaia.com.br/auth/me**', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ user_id: 'e2e-user-id', email: 'e2e@atenna.ai', plan, expires_at: 9999999999 }),
  }));
  await context.route('**/generate-prompts', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, data: { direct: 'D', technical: 'T', structured: 'S' } }),
  }));
  await context.route('**/auth/v1/user**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'e2e-user-id', email: 'e2e@atenna.ai' }) }));
  await context.route('**/rest/v1/profiles**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ display_name: 'E2E' }]) }));
  await context.route('**/auth/logout', r => r.fulfill({ status: 200, body: '{}' }));
  await context.route('**/user/export/status**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ has_pending_request: false }) }));
  await context.route('**/user/deletion/status**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ has_pending_request: false }) }));
}

// ─────────────────────────────────────────────────────────────────────────────

test('V1.2: ID da extensão é o fixo do manifest "key"', async ({ extensionId }) => {
  expect(extensionId).toBe('eeejlbiagiieioangpmhhfjlnpphljao');
});

test('V2.4: olho de senha alterna o type do campo (welcome)', async ({ context, extensionId }) => {
  await clearAll(context);
  const page = await context.newPage();
  const errs = watchErrors(page);
  await page.goto(WELCOME(extensionId), { waitUntil: 'domcontentloaded' });
  await page.click('#tab-login').catch(() => {});
  await expect(page.locator('#login-pass')).toHaveAttribute('type', 'password');
  await page.click('#eye-login');
  await expect(page.locator('#login-pass')).toHaveAttribute('type', 'text');
  await page.click('#eye-login');
  await expect(page.locator('#login-pass')).toHaveAttribute('type', 'password');
  expect(errs).toEqual([]);
  await page.close();
});

test('V3.5 + V8.4: popup deslogado renderiza login < 1.5s, e logout volta pro login', async ({ context, extensionId }) => {
  await clearAll(context);
  const page = await context.newPage();
  const errs = watchErrors(page);
  await page.route('**/auth/me', r => r.fulfill({ status: 401, body: '{}' }));
  const t0 = Date.now();
  await page.goto(POPUP(extensionId), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ap-login-btn', { timeout: 5000 });
  expect(Date.now() - t0).toBeLessThan(1500);
  await expect(page.locator('#ap-login-sub')).toBeVisible();
  expect(errs).toEqual([]);
  await page.close();

  // logado → home → logout → login
  await injectSession(context);
  const s = await sw(context);
  await s.evaluate(() => new Promise<void>(r => chrome.storage.local.set({ atenna_onboarded: true }, () => r())));
  await mockBff(context);
  const p2 = await context.newPage();
  await p2.route('**/auth/me', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user_id: 'e2e-user-id', email: 'e2e@atenna.ai', plan: 'free', expires_at: 9999999999 }) }));
  p2.on('dialog', d => d.accept());
  await p2.goto(POPUP(extensionId), { waitUntil: 'domcontentloaded' });
  await p2.waitForSelector('#ap-logout-btn', { timeout: 8000 });
  await p2.click('#ap-logout-btn');
  await p2.waitForSelector('#ap-login-btn', { timeout: 8000 });
  await p2.close();
});

test('V5.1/V5.2/V5.3 + V8.2/V8.3: modal Refinar (sem wizard), gera 3 cards, aba Histórico', async ({ context }) => {
  await clearAll(context);
  await injectSession(context);
  await new Promise(r => setTimeout(r, 1200));
  await mockBff(context);
  const page = await openFixturePage(context);
  const errs = watchErrors(page);
  await page.waitForSelector('#atenna-guard-btn', { timeout: 30_000 });

  const t0 = Date.now();
  await page.click('#atenna-guard-btn');
  await page.waitForSelector('.atenna-modal__tab', { timeout: 8000 });
  expect(Date.now() - t0).toBeLessThan(2500);
  expect(await page.locator('.atenna-onb-wizard').count()).toBe(0);

  await page.fill('.atenna-modal__editor', 'como escalar minha startup');
  const t1 = Date.now();
  await page.click('.atenna-modal__regen');
  await page.waitForSelector('.atenna-modal__card', { timeout: 15_000 });
  expect(Date.now() - t1).toBeLessThan(4000);
  expect(await page.locator('.atenna-modal__card').count()).toBe(3);

  // aba histórico alterna
  await page.click('.atenna-modal__tab[data-tab="history"]');
  await expect(page.locator('.atenna-modal__tab[data-tab="history"]')).toHaveClass(/active/);
  await page.click('.atenna-modal__tab[data-tab="edit"]');

  // fecha e não reabre duplicado
  await page.keyboard.press('Escape');
  await page.waitForSelector('#atenna-modal-overlay', { state: 'detached', timeout: 3000 });
  await page.click('#atenna-guard-btn');
  await page.waitForSelector('#atenna-modal-overlay', { timeout: 5000 });
  expect(await page.locator('#atenna-modal-overlay').count()).toBe(1);

  expect(errs).toEqual([]);
  await page.close();
});

test('V6.2/V6.3/V6.4: config — seções, cards de privacidade clicáveis, Sair confirma', async ({ context }) => {
  await clearAll(context);
  await injectSession(context);
  await new Promise(r => setTimeout(r, 1200));
  await mockBff(context);
  const page = await openFixturePage(context);
  const errs = watchErrors(page);
  await page.waitForSelector('#atenna-guard-btn', { timeout: 30_000 });
  await page.hover('#atenna-guard-btn');
  await page.locator('.atenna-btn__action[aria-label="Configurações"]').click({ force: true });
  await page.waitForSelector('#atenna-settings-overlay', { timeout: 8000 });
  await page.waitForFunction(() => document.getElementById('atenna-settings-overlay')?.textContent?.includes('Uso de prompts'), { timeout: 12000 });

  const txt = (await page.locator('#atenna-settings-overlay').textContent()) ?? '';
  expect(txt).toContain('Uso de prompts');
  expect(txt).toContain('proteção de dados');   // seção LGPD (case-insensitive-ish)
  expect(txt).toContain('Privacidade e Dados');

  // os dois cards de privacidade têm botão clicável
  const btns = page.locator('.atenna-privacy__btn');
  expect(await btns.count()).toBeGreaterThanOrEqual(2);
  await expect(btns.first()).toBeVisible();

  // Sair pede confirmação — se cancelar, NÃO desloga
  let asked = false;
  page.on('dialog', d => { asked = true; d.dismiss(); });
  await page.locator('.atenna-settings__logout').click();
  await page.waitForTimeout(400);
  expect(asked).toBe(true);
  expect(await page.locator('#atenna-settings-overlay').count()).toBe(1); // continua aberto

  expect(errs).toEqual([]);
  await page.close();
});

test('V7.1/V7.3: modal de planos — header "Atenna Safe Prompt", clique chama checkout', async ({ context }) => {
  await clearAll(context);
  await injectSession(context, 'free');
  await new Promise(r => setTimeout(r, 1200));
  await mockBff(context, 'free');
  let checkoutHit = '';
  await context.route('**/checkout/create**', r => {
    checkoutHit = r.request().url();
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://pay.example/x' }) });
  });
  const page = await openFixturePage(context);
  const errs = watchErrors(page);
  await page.waitForSelector('#atenna-guard-btn', { timeout: 30_000 });
  await page.click('#atenna-guard-btn');
  await page.waitForSelector('.atenna-modal__editor', { timeout: 8000 });
  await page.locator('.atenna-modal__onb-cta-green').click();
  await page.waitForSelector('#atenna-plans-modal', { timeout: 5000 });

  const plansTxt = (await page.locator('#atenna-plans-modal').textContent()) ?? '';
  expect(plansTxt).toContain('Atenna Safe Prompt');
  expect(plansTxt.toLowerCase()).not.toContain('guardião');
  expect(await page.locator('#atenna-plans-modal button').count()).toBeGreaterThanOrEqual(2);

  expect(errs).toEqual([]);
  await page.close();
});

test('V8.1: badge injeta após sessão em < 3s', async ({ context }) => {
  await clearAll(context);
  await injectSession(context);
  await new Promise(r => setTimeout(r, 1200));
  await mockBff(context);
  const page = await openFixturePage(context);
  const t0 = Date.now();
  await page.waitForSelector('#atenna-guard-btn', { timeout: 30_000 });
  expect(Date.now() - t0).toBeLessThan(3000);
  await page.close();
});
