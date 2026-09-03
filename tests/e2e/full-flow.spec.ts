/**
 * FASE 10.7 — fluxo ponta a ponta com a extensão carregada de verdade no Chromium.
 * Percorre: deslogado → login → badge → modal (Refinar) → gerar → configurações → sair.
 * Não mocka a lógica da extensão; só as respostas de rede do backend.
 */
import { test, expect, injectSession, openFixturePage } from './helpers/extension';
import type { BrowserContext } from '@playwright/test';

const FIXTURE = 'http://localhost:4200/chatgpt.html';

async function sw(context: BrowserContext) {
  let [s] = context.serviceWorkers();
  if (!s) s = await context.waitForEvent('serviceworker', { timeout: 10_000 });
  return s;
}

async function clearAll(context: BrowserContext) {
  const s = await sw(context);
  await s.evaluate(() => new Promise<void>((r) =>
    chrome.storage.local.clear(() => r()),
  ));
}

// Mocks de rede — /generate-prompts sai do service worker, então precisa de context.route.
async function mockBff(context: BrowserContext) {
  await context.route('**/api.atennaia.com.br/auth/me**', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ user_id: 'e2e-user-id', email: 'e2e@atenna.ai', plan: 'free', expires_at: 9999999999 }),
  }));
  await context.route('**/generate-prompts', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, data: {
      direct: 'Versao direta gerada pelo E2E', technical: 'Versao tecnica E2E', structured: 'Versao estruturada E2E',
    } }),
  }));
  await context.route('**/auth/v1/user**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'e2e-user-id', email: 'e2e@atenna.ai' }) }));
  await context.route('**/rest/v1/profiles**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ display_name: 'E2E' }]) }));
  await context.route('**/auth/logout', (r) => r.fulfill({ status: 200, body: '{}' }));
}

// ─────────────────────────────────────────────────────────────────────────────

test('F1: deslogado — nada na página da IA, mas o ícone da extensão dá login', async ({ context, extensionId }) => {
  await clearAll(context);

  // página da IA: nenhum badge, nenhum chip
  const ai = await context.newPage();
  await ai.route('**/auth/me', (r) => r.fulfill({ status: 401, body: '{}' }));
  await ai.goto(FIXTURE);
  await ai.waitForTimeout(4000);
  expect(await ai.$('#atenna-guard-btn')).toBeNull();
  await ai.close();

  // popup: login + mensagem amigável, não some
  const popup = await context.newPage();
  await popup.route('**/auth/me', (r) => r.fulfill({ status: 401, body: '{}' }));
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
  await popup.waitForSelector('#ap-login-btn', { timeout: 10_000 });
  const sub = (await popup.locator('#ap-login-sub').textContent()) ?? '';
  expect(sub.toLowerCase()).toMatch(/prote|libera|prompt/);
  await popup.waitForTimeout(1500);
  await expect(popup.locator('#ap-login-btn')).toBeVisible();
  await popup.close();
});

test('F2: login pelo popup grava a sessão', async ({ context, extensionId }) => {
  await clearAll(context);
  const popup = await context.newPage();
  await popup.route('**/api.atennaia.com.br/auth/login', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ token: 'opaque-e2e-token', email: 'e2e@atenna.ai', plan: 'free', expires_at: 9999999999, user_id: 'e2e-user-id' }),
  }));
  await popup.route('**/auth/me', (r) => r.fulfill({ status: 401, body: '{}' }));
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
  await popup.waitForSelector('#ap-login-btn', { timeout: 10_000 });
  await popup.fill('#ap-email', 'e2e@atenna.ai');
  await popup.fill('#ap-pass', 'senha123');
  await popup.click('#ap-login-btn');

  // sessão foi persistida no chrome.storage (cifrada)
  await expect.poll(async () => {
    const s = await sw(context);
    return s.evaluate(() => new Promise<boolean>((res) =>
      chrome.storage.local.get('atenna_session', (r) => res(!!r['atenna_session'])),
    ));
  }, { timeout: 8000 }).toBe(true);
  await popup.close();
});

test('F3: logado — badge aparece → clicar abre o modal Refinar (SEM wizard de onboarding)', async ({ context }) => {
  await clearAll(context);
  await injectSession(context);
  await new Promise((r) => setTimeout(r, 1500));

  await mockBff(context);
  const page = await openFixturePage(context);
  await page.waitForSelector('#atenna-guard-btn', { timeout: 30_000 });

  await page.click('#atenna-guard-btn');
  await page.waitForSelector('#atenna-modal-overlay', { timeout: 5000 });
  await page.waitForSelector('.atenna-modal__tab', { timeout: 8000 });

  const state = await page.evaluate(() => {
    const m = document.querySelector('#atenna-modal-overlay')!;
    return {
      wizard: !!m.querySelector('.atenna-onb-wizard'),
      tabs: m.querySelectorAll('.atenna-modal__tab').length,
      hasEditor: !!m.querySelector('.atenna-modal__editor'),
    };
  });
  expect(state.wizard).toBe(false);   // <- o bug que o dono achou
  expect(state.tabs).toBe(2);
  expect(state.hasEditor).toBe(true);
  await page.close();
});

test('F4: refinar — digitar texto e clicar Refinar produz os cards', async ({ context }) => {
  await clearAll(context);
  await injectSession(context);
  await new Promise((r) => setTimeout(r, 1500));

  await mockBff(context);
  const page = await openFixturePage(context);
  await page.waitForSelector('#atenna-guard-btn', { timeout: 30_000 });
  await page.click('#atenna-guard-btn');
  await page.waitForSelector('.atenna-modal__editor', { timeout: 8000 });

  await page.fill('.atenna-modal__editor', 'como escalar minha startup de SaaS');
  await page.click('.atenna-modal__regen');

  // os 3 cards de prompt aparecem (Direto / Técnico / Estruturado)
  await page.waitForSelector('.atenna-modal__card', { timeout: 20_000 });
  await expect(page.locator('.atenna-modal__card')).toHaveCount(3);
  await expect(page.locator('#atenna-modal-overlay')).toContainText('Direto');
  await page.close();
});

test('F5: configurações — abre e mostra o email logado; Sair remove o badge', async ({ context }) => {
  await clearAll(context);
  await injectSession(context);
  await new Promise((r) => setTimeout(r, 1500));

  await mockBff(context);
  const page = await openFixturePage(context);
  await page.waitForSelector('#atenna-guard-btn', { timeout: 30_000 });

  // abre configurações pela engrenagem do badge
  await page.hover('#atenna-guard-btn');
  await page.locator('.atenna-btn__action[aria-label="Configurações"]').click({ force: true });
  await page.waitForSelector('#atenna-settings-overlay', { timeout: 8000 });
  await expect(page.locator('#atenna-settings-overlay')).toContainText('e2e@atenna.ai');

  // Sair → sessão limpa → badge some
  await page.locator('.atenna-settings__logout').click();
  await page.waitForSelector('#atenna-guard-btn', { state: 'detached', timeout: 10_000 });
  expect(await page.$('#atenna-guard-btn')).toBeNull();
  await page.close();
});

test('F6: usuário PRO NÃO vê upsell do produto no modal', async ({ context }) => {
  await clearAll(context);
  await injectSession(context, 'pro');
  // plano já é pro no storage → evita o overlay de pro-welcome no 1º open
  let [sw6] = context.serviceWorkers();
  if (!sw6) sw6 = await context.waitForEvent('serviceworker', { timeout: 10_000 });
  await sw6.evaluate(() => new Promise<void>((r) => chrome.storage.local.set({
    'atenna_plan': { type: 'pro', planType: 'monthly', validUntil: 9999999999999 },
    'atenna_plan__e2e-user-id': { type: 'pro', planType: 'monthly', validUntil: 9999999999999 },
    'atenna_pro_welcome_pending': false,
    'atenna_pro_welcome_pending__e2e-user-id': false,
  }, () => r())));
  await new Promise((r) => setTimeout(r, 1500));
  // /auth/me tem que dizer pro tb (planManager sincroniza)
  await context.route('**/api.atennaia.com.br/auth/me**', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ user_id: 'e2e-user-id', email: 'e2e@atenna.ai', plan: 'pro', expires_at: 9999999999 }),
  }));
  await context.route('**/generate-prompts', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { direct: 'x', technical: 'y', structured: 'z' } }) }));
  await context.route('**/auth/v1/user**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'e2e-user-id', email: 'e2e@atenna.ai' }) }));

  const page = await openFixturePage(context);
  // page.route tem prioridade sobre context.route — sobrescreve o /auth/me do helper
  await page.route('**/auth/me', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ user_id: 'e2e-user-id', email: 'e2e@atenna.ai', plan: 'pro', expires_at: 9999999999, onboarding_seen: true }),
  }));
  await page.waitForSelector('#atenna-guard-btn', { timeout: 30_000 });
  await page.click('#atenna-guard-btn');
  await page.waitForSelector('.atenna-modal__editor', { timeout: 8000 });
  await page.waitForTimeout(800);

  // nenhum CTA de upsell "Quero prompts ilimitados..."
  expect(await page.locator('.atenna-modal__onb-cta-green').count()).toBe(0);
  expect(await page.locator('text=Quero prompts ilimitados').count()).toBe(0);
  await page.close();
});

test('F7: usuário FREE VÊ o upsell no modal (contraprova)', async ({ context }) => {
  await clearAll(context);
  await injectSession(context, 'free');
  await new Promise((r) => setTimeout(r, 1500));
  await mockBff(context);
  const page = await openFixturePage(context);
  await page.waitForSelector('#atenna-guard-btn', { timeout: 30_000 });
  await page.click('#atenna-guard-btn');
  await page.waitForSelector('.atenna-modal__editor', { timeout: 8000 });
  await page.waitForTimeout(800);
  expect(await page.locator('.atenna-modal__onb-cta-green').count()).toBe(1);
  await page.close();
});

test('F8 [SEGURANÇA]: histórico NÃO vaza entre contas na mesma máquina', async ({ context }) => {
  await clearAll(context);

  // ── Usuário A gera um prompt ──
  await injectSession(context, 'free', 'user-A-id', 'a@atenna.ai');
  await new Promise((r) => setTimeout(r, 1200));
  await context.route('**/api.atennaia.com.br/auth/me**', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ user_id: 'user-A-id', email: 'a@atenna.ai', plan: 'free', expires_at: 9999999999 }),
  }));
  await context.route('**/generate-prompts', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { direct: 'PROMPT SECRETO DE A', technical: 'x', structured: 'y' } }) }));
  await context.route('**/auth/v1/user**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'user-A-id', email: 'a@atenna.ai' }) }));

  let page = await openFixturePage(context);
  await page.route('**/auth/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user_id: 'user-A-id', email: 'a@atenna.ai', plan: 'free', expires_at: 9999999999 }) }));
  await page.waitForSelector('#atenna-guard-btn', { timeout: 30_000 });
  await page.click('#atenna-guard-btn');
  await page.waitForSelector('.atenna-modal__editor', { timeout: 8000 });
  await page.fill('.atenna-modal__editor', 'segredo do usuario A sobre a empresa dele');
  await page.click('.atenna-modal__regen');
  await page.waitForSelector('.atenna-modal__card', { timeout: 15_000 });
  await page.close();

  // ── Usuário B loga na mesma máquina, abre o modal ──
  await context.unroute('**/api.atennaia.com.br/auth/me**');
  await injectSession(context, 'free', 'user-B-id', 'b@atenna.ai');
  await new Promise((r) => setTimeout(r, 1200));
  await context.route('**/api.atennaia.com.br/auth/me**', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ user_id: 'user-B-id', email: 'b@atenna.ai', plan: 'free', expires_at: 9999999999 }),
  }));
  await context.route('**/auth/v1/user**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'user-B-id', email: 'b@atenna.ai' }) }));

  page = await openFixturePage(context);
  await page.route('**/auth/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user_id: 'user-B-id', email: 'b@atenna.ai', plan: 'free', expires_at: 9999999999 }) }));
  await page.waitForSelector('#atenna-guard-btn', { timeout: 30_000 });
  await page.click('#atenna-guard-btn');
  await page.waitForSelector('.atenna-modal__tab', { timeout: 8000 });
  await page.click('.atenna-modal__tab[data-tab="history"]');
  await page.waitForTimeout(1500);

  const txt = (await page.locator('#atenna-modal-overlay').textContent()) ?? '';
  expect(txt).not.toContain('segredo do usuario A');
  expect(txt).not.toContain('PROMPT SECRETO DE A');
  await page.close();
});
