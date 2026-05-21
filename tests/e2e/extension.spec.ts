import { test, expect, injectSession, openFixturePage, openPerplexityFixture } from './helpers/extension';

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
  // Delay to ensure storage write settles AND previous test's page has closed
  await new Promise(r => setTimeout(r, 500));
  const page = await openFixturePage(context);
  await page.waitForSelector('#atenna-guard-btn', { timeout: 25_000 });

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

// ─── Test 6: Modal opens from badge click ─────────────────────

test('T6: clicking the badge opens the Atenna modal overlay', async ({ context }) => {
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
  // Mock BFF /auth/me so toggleModal() sees a valid session and renders the full modal
  await context.route('**/maestro-n8n.site/auth/me**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user_id: 'e2e-user-id', email: 'e2e@atenna.ai', plan: 'pro', expires_at: 9999999999 }),
    })
  );

  await injectSession(context);
  // Set the user-scoped onboarding flag so openModal() renders the main UI, not the onboarding screen.
  // The content script calls sk('atenna_app_onboarding_seen') which appends __<uid> when uid is loaded.
  // We must set it BEFORE the page opens so the content script reads it after session init.
  const sw = context.serviceWorkers()[0];
  if (sw) {
    await sw.evaluate(() => new Promise<void>(resolve => {
      chrome.storage.local.set({ 'atenna_app_onboarding_seen__e2e-user-id': true }, () => resolve());
    }));
  }
  await new Promise(r => setTimeout(r, 300));
  const page = await openFixturePage(context);
  await page.waitForSelector('#atenna-guard-btn', { timeout: 15_000 });

  // Click the badge button
  await page.click('#atenna-guard-btn');

  // Modal overlay should appear
  await page.waitForSelector('#atenna-modal-overlay', { timeout: 5_000 });

  const overlay = await page.$('#atenna-modal-overlay');
  expect(overlay).not.toBeNull();

  // Modal must have the tab bar (Refinar / Histórico)
  const tabs = await page.$$('.atenna-modal__tab');
  expect(tabs.length).toBe(2);

  // Close with ESC — modal must disappear
  await page.keyboard.press('Escape');
  await page.waitForSelector('#atenna-modal-overlay', { state: 'detached', timeout: 3_000 });
  const overlayAfter = await page.$('#atenna-modal-overlay');
  expect(overlayAfter).toBeNull();

  await page.close();
});

// ─── Test 7: Perplexity DLP — banner aparece ──────────────────

test('T7: DLP banner appears when CPF is typed into Perplexity-like textarea', async ({ context }) => {
  await context.route('**/auth/v1/user**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ id: 'e2e-user-id', email: 'e2e@atenna.ai' }) })
  );
  await context.route('**/rest/v1/profiles**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([{ display_name: 'E2E User' }]) })
  );

  await injectSession(context);
  await new Promise(r => setTimeout(r, 400));
  const page = await openPerplexityFixture(context);
  await page.waitForSelector('#atenna-guard-btn', { timeout: 20_000 });

  // Type CPF into Perplexity textarea
  await page.click('#prompt-textarea');
  await page.type('#prompt-textarea', 'Meu CPF é 123.456.789-09', { delay: 30 });
  await page.dispatchEvent('#prompt-textarea', 'input');

  // Wait for DLP debounce (400ms) + render
  await page.waitForTimeout(1200);
  await page.waitForSelector('#atenna-protection-banner', { timeout: 6_000 });

  const banner = await page.$('#atenna-protection-banner');
  expect(banner).not.toBeNull();

  const text = await banner!.textContent();
  expect(text).toContain('Dados sensíveis');

  await page.close();
});

// ─── Test 8: Perplexity DLP — "Proteger dados" mascara CPF ────

test('T8: clicking "Proteger dados" masks CPF in Perplexity React-controlled textarea', async ({ context }) => {
  await context.route('**/auth/v1/user**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ id: 'e2e-user-id', email: 'e2e@atenna.ai' }) })
  );
  await context.route('**/rest/v1/profiles**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([{ display_name: 'E2E User' }]) })
  );

  await injectSession(context);
  await new Promise(r => setTimeout(r, 400));
  const page = await openPerplexityFixture(context);
  await page.waitForSelector('#atenna-guard-btn', { timeout: 20_000 });

  // Type CPF
  await page.click('#prompt-textarea');
  await page.type('#prompt-textarea', 'Meu CPF é 123.456.789-09', { delay: 30 });
  await page.dispatchEvent('#prompt-textarea', 'input');
  await page.waitForTimeout(1200);
  await page.waitForSelector('#atenna-protection-banner', { timeout: 6_000 });

  // Capture value before protect
  const valueBefore = await page.$eval('#prompt-textarea', (el: HTMLTextAreaElement) => el.value);
  expect(valueBefore).toContain('123.456.789-09');

  // Click "Proteger dados"
  await page.click('.atenna-protection-banner__btn--primary');

  // Wait for the setTimeout(0) + setInputText to complete
  await page.waitForTimeout(300);

  // Verify DOM value changed
  const valueDomAfter = await page.$eval('#prompt-textarea', (el: HTMLTextAreaElement) => el.value);

  // Verify React internal value changed (via window.__atenna_test)
  const valueReactAfter = await page.evaluate(() => {
    const w = window as typeof window & { __atenna_test?: { getReactValue(): string } };
    return w.__atenna_test?.getReactValue() ?? '';
  });

  // Both DOM and React state must contain [CPF], not the raw number
  expect(valueDomAfter).toContain('[CPF]');
  expect(valueDomAfter).not.toContain('123.456.789-09');

  expect(valueReactAfter).toContain('[CPF]');
  expect(valueReactAfter).not.toContain('123.456.789-09');

  // Banner must be dismissed
  const banner = await page.$('#atenna-protection-banner');
  expect(banner).toBeNull();

  await page.close();
});
