/**
 * welcome.html × backend REAL (api.atennaia.com.br) — SEM mocks.
 *
 * Valida o fluxo front→backend de verdade: signup → login → forgot-password.
 * Cria usuários e2e-welcome-<ts>@atenna.test no Supabase — limpar com:
 *   ssh atenna-vps "docker exec atenna-backend-backend-1 python -c \"
 *     from services.supabase_admin import get_admin_client as c
 *     s=c(); [s.auth.admin.delete_user(u.id) for u in s.auth.admin.list_users()
 *            if u.email and u.email.startswith('e2e-welcome-')]\""
 *
 * Rodar: npx playwright test --project=welcome-real
 */
import { test, expect } from './helpers/extension';

const WELCOME = (id: string) => `chrome-extension://${id}/welcome.html`;
const PASS = 'WelcomeReal!2026';

test('signup real → "Conta criada" → login real → tela de sucesso', async ({ context, extensionId }) => {
  const email = `e2e-welcome-${Date.now()}@atenna.test`;
  const page = await context.newPage();
  await page.goto(WELCOME(extensionId));

  // ── SIGNUP (form real → POST real /auth/signup) ──
  await page.click('#tab-signup');
  await page.fill('#signup-name', 'E2E Welcome');
  await page.fill('#signup-email', email);
  await page.fill('#signup-pass', PASS);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auth/signup') && r.request().method() === 'POST', { timeout: 20_000 }),
    page.click('#signup-btn'),
  ]);
  await expect(page.locator('#w-signup-success')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#w-title')).toContainText('Conta criada');

  // ── LOGIN (mesmas credenciais, POST real /auth/login) ──
  await page.click('#signup-success-back');   // volta pro login
  await page.fill('#login-email', email);
  await page.fill('#login-pass', PASS);
  const [loginResp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auth/login') && r.request().method() === 'POST', { timeout: 20_000 }),
    page.click('#login-btn'),
  ]);
  expect(loginResp.status()).toBe(200);
  const body = await loginResp.json();
  expect(body.token).toBeTruthy();
  expect(body.plan).toBe('free');
  await expect(page.locator('#w-success')).toBeVisible({ timeout: 10_000 });

  await page.close();
});

test('login real com senha errada → erro amigável', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(WELCOME(extensionId));
  await page.fill('#login-email', 'e2e-harness@atenna.internal');
  await page.fill('#login-pass', 'senha-errada-de-proposito');
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auth/login'), { timeout: 20_000 }),
    page.click('#login-btn'),
  ]);
  expect(resp.status()).toBe(401);
  await expect(page.locator('#w-err')).toBeVisible();
  await page.close();
});

test('forgot-password real → POST /auth/reset-password → "Link enviado"', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(WELCOME(extensionId));
  await page.click('#forgot-link');
  await page.fill('#forgot-email', 'e2e-harness@atenna.internal');
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auth/reset-password'), { timeout: 20_000 }),
    page.click('#forgot-btn'),
  ]);
  expect(resp.status()).toBe(200);
  await expect(page.locator('#w-info')).toContainText('Link enviado');
  // NOTA: o recebimento REAL do email depende de Resend verificado + SMTP no Supabase.
  await page.close();
});
