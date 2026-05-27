/**
 * Welcome page E2E tests — testa todos os fluxos da tela de boas-vindas:
 * estrutura, logos, tabs, validações, signup→verify, login→success, forgot password, Google retry.
 */
import { test, expect } from './helpers/extension';

// ─── helpers ───────────────────────────────────────────────────────────────────

async function clearSession(context: import('@playwright/test').BrowserContext): Promise<void> {
  let [sw] = context.serviceWorkers();
  if (!sw) {
    sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
  }
  await sw.evaluate(() => new Promise<void>(r =>
    chrome.storage.local.remove(['atenna_session', 'atenna_jwt'], () => r())
  ));
}

async function openWelcomePage(context: import('@playwright/test').BrowserContext, extensionId: string) {
  // Clear any session left by extension tests so welcome page starts unauthenticated
  await clearSession(context);
  const page = await context.newPage();

  // Mock BFF endpoints usados pelo welcome.ts
  await page.route('**/atennaplugin.maestro-n8n.site/auth/login', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        token: 'mock-token-123',
        email: 'teste@atenna.ai',
        plan: 'free',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user_id: 'mock-user-id',
      }),
    })
  );
  await page.route('**/atennaplugin.maestro-n8n.site/auth/reset-password', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  );
  // BFF signup endpoint
  await page.route('**/atennaplugin.maestro-n8n.site/auth/signup', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    })
  );

  await page.goto(`chrome-extension://${extensionId}/welcome.html`, { waitUntil: 'domcontentloaded' });
  return page;
}

// ─── W1: Estrutura da página ───────────────────────────────────────────────────

test('W1: welcome page loads with left panel and right panel', async ({ context, extensionId }) => {
  const page = await openWelcomePage(context, extensionId);

  // Painel esquerdo — brand
  await expect(page.locator('.w-brand')).toBeVisible();
  await expect(page.locator('.w-brand-name')).toHaveText('Atenna Safe Prompt');

  // Hero copy
  await expect(page.locator('.w-hero h1')).toBeVisible();
  const heroText = await page.locator('.w-hero h1').textContent();
  expect(heroText).toContain('vazar');

  // Painel direito — título inicial
  await expect(page.locator('#w-title')).toBeVisible();

  // Tabs existem
  await expect(page.locator('#tab-login')).toBeVisible();
  await expect(page.locator('#tab-signup')).toBeVisible();

  // Botão Google existe
  await expect(page.locator('#w-google-btn')).toBeVisible();

  // Formulário de login visível por padrão
  await expect(page.locator('#form-login')).toBeVisible();
  await expect(page.locator('#form-signup')).toBeHidden();

  await page.close();
});

// ─── W2: Logos reais das plataformas ──────────────────────────────────────────

test('W2: platform chips show real brand logo images', async ({ context, extensionId }) => {
  const page = await openWelcomePage(context, extensionId);

  const chips = page.locator('.w-plat-chip');
  await expect(chips).toHaveCount(4);

  // Cada chip deve ter um <img> com src apontando para um .svg real
  const imgs = page.locator('.w-plat-chip img');
  await expect(imgs).toHaveCount(4);

  const srcs = await imgs.evaluateAll((els: HTMLImageElement[]) => els.map(e => e.src));
  expect(srcs.some(s => s.includes('openai.svg'))).toBe(true);
  expect(srcs.some(s => s.includes('anthropic.svg'))).toBe(true);
  expect(srcs.some(s => s.includes('gemini.svg'))).toBe(true);
  expect(srcs.some(s => s.includes('perplexity.svg'))).toBe(true);

  // Verifica que os textos dos chips estão corretos
  const chipsText = await chips.allTextContents();
  expect(chipsText.join(' ')).toContain('ChatGPT');
  expect(chipsText.join(' ')).toContain('Claude');
  expect(chipsText.join(' ')).toContain('Gemini');
  expect(chipsText.join(' ')).toContain('Perplexity');

  await page.close();
});

// ─── W3: Troca de tabs ────────────────────────────────────────────────────────

test('W3: tab switching shows correct form and hides the other', async ({ context, extensionId }) => {
  const page = await openWelcomePage(context, extensionId);

  // Padrão: login ativo
  await expect(page.locator('#tab-login')).toHaveClass(/active/);
  await expect(page.locator('#form-login')).toBeVisible();
  await expect(page.locator('#form-signup')).toBeHidden();

  // Clicar em "Criar conta"
  await page.click('#tab-signup');
  await expect(page.locator('#tab-signup')).toHaveClass(/active/);
  await expect(page.locator('#form-signup')).toBeVisible();
  await expect(page.locator('#form-login')).toBeHidden();
  await expect(page.locator('#w-title')).toContainText('Crie sua conta');

  // Voltar para login
  await page.click('#tab-login');
  await expect(page.locator('#form-login')).toBeVisible();
  await expect(page.locator('#form-signup')).toBeHidden();
  await expect(page.locator('#w-title')).toContainText('Bem-vindo');

  await page.close();
});

// ─── W4: Validação do form de login ───────────────────────────────────────────

test('W4: login form shows field errors for empty fields', async ({ context, extensionId }) => {
  const page = await openWelcomePage(context, extensionId);

  // Submeter sem preencher nada
  await page.click('#login-btn');

  const emailErr = page.locator('#login-email-err');
  await expect(emailErr).toHaveText('Informe o email');

  // Preencher email mas não senha
  await page.fill('#login-email', 'usuario@teste.com');
  await page.click('#login-btn');

  const passErr = page.locator('#login-pass-err');
  await expect(passErr).toHaveText('Informe a senha');

  await page.close();
});

// ─── W5: Validação do form de signup ──────────────────────────────────────────

test('W5: signup form shows field errors for empty name and short password', async ({ context, extensionId }) => {
  const page = await openWelcomePage(context, extensionId);
  await page.click('#tab-signup');

  // Submeter vazio
  await page.click('#signup-btn');
  await expect(page.locator('#signup-name-err')).toHaveText('Informe seu nome');

  // Nome preenchido, sem email
  await page.fill('#signup-name', 'Diego Teste');
  await page.click('#signup-btn');
  await expect(page.locator('#signup-email-err')).toHaveText('Informe o email');

  // Nome + email, senha curta
  await page.fill('#signup-email', 'novo@atenna.ai');
  await page.fill('#signup-pass', '123');
  await page.click('#signup-btn');
  await expect(page.locator('#signup-pass-err')).toHaveText('Mínimo 6 caracteres');

  await page.close();
});

// ─── W6: Toggle de senha (eye button) ─────────────────────────────────────────

test('W6: eye button toggles password field visibility', async ({ context, extensionId }) => {
  const page = await openWelcomePage(context, extensionId);

  const passInput = page.locator('#login-pass');
  await expect(passInput).toHaveAttribute('type', 'password');

  await page.click('#eye-login');
  await expect(passInput).toHaveAttribute('type', 'text');

  await page.click('#eye-login');
  await expect(passInput).toHaveAttribute('type', 'password');

  await page.close();
});

// ─── W7: Fluxo de signup → tela de verificação de email ──────────────────────

test('W7: signup with valid data shows email verify screen with correct email', async ({ context, extensionId }) => {
  const page = await openWelcomePage(context, extensionId);
  await page.click('#tab-signup');

  await page.fill('#signup-name', 'Diego Atenna');
  await page.fill('#signup-email', 'novo@atenna.ai');
  await page.fill('#signup-pass', 'senha123');

  await page.click('#signup-btn');

  // Aguarda tela de verificação
  await page.waitForSelector('#w-verify', { state: 'visible', timeout: 5000 });

  // Tela de verify deve mostrar o email correto
  await expect(page.locator('#verify-email-val')).toHaveText('novo@atenna.ai');
  await expect(page.locator('#w-title')).toHaveText('Verifique seu email');

  // Formulário e tabs devem estar ocultos
  await expect(page.locator('#form-signup')).toBeHidden();
  await expect(page.locator('#w-tabs')).toBeHidden();
  await expect(page.locator('#w-google-btn')).toBeHidden();

  // Botão "Abrir Gmail" existe e tem link correto
  const gmailLink = page.locator('a.w-open-mail');
  await expect(gmailLink).toBeVisible();
  await expect(gmailLink).toHaveAttribute('href', 'https://mail.google.com/');

  // Botão "Voltar ao login" funciona
  await page.click('#verify-back');
  await expect(page.locator('#w-verify')).toBeHidden();
  await expect(page.locator('#form-login')).toBeVisible();
  await expect(page.locator('#w-tabs')).toBeVisible();

  await page.close();
});

// ─── W8: Fluxo de login → tela de sucesso ────────────────────────────────────

test('W8: login with valid credentials shows success screen with platform links', async ({ context, extensionId }) => {
  const page = await openWelcomePage(context, extensionId);

  await page.fill('#login-email', 'teste@atenna.ai');
  await page.fill('#login-pass', 'minhasenha');

  await page.click('#login-btn');

  // Aguarda tela de sucesso
  await page.waitForSelector('#w-success', { state: 'visible', timeout: 5000 });

  await expect(page.locator('#w-title')).toContainText('Proteção ativada');
  await expect(page.locator('#w-sub')).toContainText('teste@atenna.ai');

  // Links das plataformas visíveis
  const platformLinks = page.locator('.w-plat-link');
  await expect(platformLinks).toHaveCount(4);

  const hrefs = await platformLinks.evaluateAll((els: HTMLAnchorElement[]) => els.map(e => e.href));
  expect(hrefs.some(h => h.includes('chatgpt.com'))).toBe(true);
  expect(hrefs.some(h => h.includes('claude.ai'))).toBe(true);
  expect(hrefs.some(h => h.includes('gemini.google.com'))).toBe(true);
  expect(hrefs.some(h => h.includes('perplexity.ai'))).toBe(true);

  // Logos reais nos links de sucesso também
  const successImgs = page.locator('.w-plat-links img');
  await expect(successImgs).toHaveCount(4);

  await page.close();
});

// ─── W9: Login com credenciais inválidas → mensagem de erro ──────────────────

test('W9: login with wrong credentials shows error message', async ({ context, extensionId }) => {
  const page = await context.newPage();
  // Mock retornando 401
  await page.route('**/atennaplugin.maestro-n8n.site/auth/login', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"invalid"}' })
  );
  await page.goto(`chrome-extension://${extensionId}/welcome.html`, { waitUntil: 'domcontentloaded' });

  await page.fill('#login-email', 'errado@teste.com');
  await page.fill('#login-pass', 'senhaerrada');
  await page.click('#login-btn');

  const errAlert = page.locator('#w-err');
  await expect(errAlert).toBeVisible({ timeout: 5000 });
  await expect(errAlert).toContainText('Email ou senha incorretos');

  // Botão deve estar re-habilitado
  await expect(page.locator('#login-btn')).toBeEnabled();
  await expect(page.locator('#login-btn')).toHaveText('Entrar');

  await page.close();
});

// ─── W10: Fluxo de "Esqueci minha senha" ─────────────────────────────────────

test('W10: forgot password flow shows form, hides tabs, sends link and shows success info', async ({ context, extensionId }) => {
  const page = await openWelcomePage(context, extensionId);

  // Clicar em "Esqueci minha senha"
  await page.click('#forgot-link');

  // Tabs e Google devem estar ocultos
  await expect(page.locator('#w-tabs')).toBeHidden();
  await expect(page.locator('#w-google-btn')).toBeHidden();
  await expect(page.locator('#form-forgot')).toBeVisible();
  await expect(page.locator('#w-title')).toContainText('Recuperar senha');

  // Validação: campo vazio
  await page.click('#forgot-btn');
  await expect(page.locator('#forgot-email-err')).toHaveText('Informe o email');

  // Preencher e enviar (mock retorna 200)
  await page.fill('#forgot-email', 'usuario@atenna.ai');
  await page.click('#forgot-btn');

  // Mensagem de sucesso
  const infoAlert = page.locator('#w-info');
  await expect(infoAlert).toBeVisible({ timeout: 5000 });
  await expect(infoAlert).toContainText('Link enviado');

  // Botão muda para "Reenviar link"
  await expect(page.locator('#forgot-btn')).toHaveText('Reenviar link');

  // Voltar ao login
  await page.click('#back-to-login');
  await expect(page.locator('#form-login')).toBeVisible();
  await expect(page.locator('#w-tabs')).toBeVisible();
  await expect(page.locator('#w-google-btn')).toBeVisible();

  await page.close();
});

// ─── W11: Google button — estado inicial e loading imediato ao clicar ────────
// Nota: chrome.identity.launchWebAuthFlow não resolve em contexto de teste sem user Chrome logado,
// então testamos apenas o estado inicial e o loading imediato pós-clique.

test('W11: Google button has correct initial state and shows loading immediately on click', async ({ context, extensionId }) => {
  const page = await openWelcomePage(context, extensionId);

  const btn = page.locator('#w-google-btn');
  const label = page.locator('#w-google-label');

  // Estado inicial: habilitado e com texto correto
  await expect(btn).toBeEnabled();
  await expect(label).toHaveText('Continuar com Google');

  // Clicar e verificar loading imediato (antes de chrome.identity resolver)
  await page.click('#w-google-btn');

  // Imediatamente após o clique deve mostrar "Aguarde…" e estar desabilitado
  await expect(label).toHaveText('Aguarde…');
  await expect(btn).toBeDisabled();

  await page.close();
});

// ─── W12: Signup com email já cadastrado → mensagem amigável ─────────────────

test('W12: signup with already registered email shows friendly error', async ({ context, extensionId }) => {
  const page = await context.newPage();
  // BFF retorna 400 com error=email_already_registered
  await page.route('**/atennaplugin.maestro-n8n.site/auth/signup', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ detail: { error: 'email_already_registered' } }),
    })
  );
  await page.goto(`chrome-extension://${extensionId}/welcome.html`, { waitUntil: 'domcontentloaded' });
  await page.click('#tab-signup');

  await page.fill('#signup-name', 'Diego');
  await page.fill('#signup-email', 'existente@atenna.ai');
  await page.fill('#signup-pass', 'senha123');
  await page.click('#signup-btn');

  const errAlert = page.locator('#w-err');
  await expect(errAlert).toBeVisible({ timeout: 5000 });
  await expect(errAlert).toContainText('já está registrado');

  // Botão re-habilitado
  await expect(page.locator('#signup-btn')).toBeEnabled();

  await page.close();
});

// ─── W13: Enter key nos inputs submete o form ─────────────────────────────────

test('W13: pressing Enter on login fields submits the form', async ({ context, extensionId }) => {
  const page = await openWelcomePage(context, extensionId);

  await page.fill('#login-email', 'teste@atenna.ai');
  await page.fill('#login-pass', 'minhasenha');

  // Pressionar Enter no campo de senha deve fazer login
  await page.press('#login-pass', 'Enter');

  await page.waitForSelector('#w-success', { state: 'visible', timeout: 5000 });
  await expect(page.locator('#w-title')).toContainText('Proteção ativada');

  await page.close();
});

// ─── W14: Link "Criar conta grátis" no form de login → troca para signup ─────

test('W14: "Criar conta grátis" link inside login form switches to signup tab', async ({ context, extensionId }) => {
  const page = await openWelcomePage(context, extensionId);

  await expect(page.locator('#form-login')).toBeVisible();
  await page.click('#to-signup-link');
  await expect(page.locator('#form-signup')).toBeVisible();
  await expect(page.locator('#tab-signup')).toHaveClass(/active/);

  await page.close();
});

// ─── W15: Link "Já tem conta? Entrar" no form de signup → login ──────────────

test('W15: "Entrar" link inside signup form switches back to login tab', async ({ context, extensionId }) => {
  const page = await openWelcomePage(context, extensionId);

  await page.click('#tab-signup');
  await expect(page.locator('#form-signup')).toBeVisible();

  await page.click('#to-login-link');
  await expect(page.locator('#form-login')).toBeVisible();
  await expect(page.locator('#tab-login')).toHaveClass(/active/);

  await page.close();
});
