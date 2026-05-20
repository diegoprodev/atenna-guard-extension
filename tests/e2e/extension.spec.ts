import { test, expect, injectSession, openFixturePage } from './helpers/extension';

// ─── T1: Extension loads ───────────────────────────────────────

test('T1: extension loads into Chromium without errors', async ({ extensionId }) => {
  expect(extensionId).toMatch(/^[a-z]{32}$/);
});

// ─── T2: Service worker is running ────────────────────────────

test('T2: service worker registers and responds to ping', async ({ context }) => {
  let [worker] = context.serviceWorkers();
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  }
  expect(worker).not.toBeNull();
  expect(worker.url()).toContain('background.js');
});

// ─── Test 3: No badge without auth ────────────────────────────

test('T3: badge does NOT inject when user is not authenticated', async ({ context }) => {
  const page = await openFixturePage(context);
  // No session injected — chrome.storage has no atenna_jwt
  // Wait 3s for any delayed injection
  await page.waitForTimeout(3000);
  const badge = await page.$('#atenna-guard-btn');
  expect(badge).toBeNull();
  await page.close();
});

// ─── Test 4: Badge injects after auth ─────────────────────────

test('T4: badge injects into #prompt-textarea after session is set', async ({ context }) => {
  // Mock Supabase user-verification endpoint so the fake JWT is treated as valid
  await context.route('**/auth/v1/user**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'e2e-user-id', email: 'e2e@atenna.ai' }),
    })
  );
  // Mock Supabase profiles endpoint (display_name lazy-load)
  await context.route('**/rest/v1/profiles**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ display_name: 'E2E User' }]),
    })
  );

  await injectSession(context);
  // Small delay to ensure storage write settles before content script reads it
  await new Promise(r => setTimeout(r, 300));
  const page = await openFixturePage(context);
  // Content script is async — wait for badge
  await page.waitForSelector('#atenna-guard-btn', { timeout: 15_000 });
  const badge = await page.$('#atenna-guard-btn');
  expect(badge).not.toBeNull();
  await page.close();
});

// ─── Test 5: DLP banner on CPF input ──────────────────────────

test('T5: DLP protection banner appears when CPF is typed into textarea', async ({ context }) => {
  // Replicate Supabase mocks from T4 so the JWT is treated as valid
  await context.route('**/auth/v1/user**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'e2e-user-id', email: 'e2e@atenna.ai' }),
    })
  );
  await context.route('**/rest/v1/profiles**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ display_name: 'E2E User' }]),
    })
  );

  await injectSession(context);
  // Small delay to ensure storage write settles before page load
  await new Promise(r => setTimeout(r, 300));
  const page = await openFixturePage(context);
  await page.waitForSelector('#atenna-guard-btn', { timeout: 20_000 });

  // Type a valid CPF — digit[2] != '9', not all same digit → passes validateCPF
  await page.fill('#prompt-textarea', 'Meu CPF é 123.456.789-09');

  // Trigger input event so DLP debounce starts (fires after 400ms)
  await page.dispatchEvent('#prompt-textarea', 'input');

  // Wait for debounce (400ms) + render buffer
  await page.waitForTimeout(1000);

  // DLP is async — wait up to 5s for banner
  await page.waitForSelector('#atenna-protection-banner', { timeout: 5_000 });

  const banner = await page.$('#atenna-protection-banner');
  expect(banner).not.toBeNull();

  // Banner must mention detected data
  const text = await banner!.textContent();
  expect(text).toContain('Dados sensíveis');

  await page.close();
});
