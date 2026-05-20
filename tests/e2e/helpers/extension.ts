import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'path';

const DIST_PATH = path.resolve(process.cwd(), 'dist');
const FIXTURE_URL = 'http://localhost:4200/chatgpt.html';

// Fake JWT that looks valid (has a base64 sub claim)
const FAKE_JWT_PAYLOAD = btoa(JSON.stringify({ sub: 'e2e-user-id', email: 'e2e@atenna.ai' }));
const FAKE_JWT = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${FAKE_JWT_PAYLOAD}.fake-sig`;

export const FAKE_SESSION = {
  access_token: FAKE_JWT,
  email: 'e2e@atenna.ai',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
};

export type ExtensionFixtures = {
  context: BrowserContext;
  extensionId: string;
};

/** Custom fixture: persistent Chromium context with the extension loaded. */
export const test = base.extend<ExtensionFixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const ctx = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${DIST_PATH}`,
        `--load-extension=${DIST_PATH}`,
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    });
    await use(ctx);
    await ctx.close();
  },

  extensionId: async ({ context }, use) => {
    // Wait for the service worker to register — its URL contains the extension ID
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker', { timeout: 10_000 });
    }
    // URL format: chrome-extension://<id>/background.js
    const id = background.url().split('/')[2];
    await use(id);
  },
});

export const expect = base.expect;

/**
 * Inject a fake authenticated session into chrome.storage.local via the service worker.
 */
export async function injectSession(context: BrowserContext): Promise<void> {
  const workers = context.serviceWorkers();
  if (workers.length === 0) return;
  await workers[0].evaluate((session) => {
    chrome.storage.local.set({ atenna_jwt: session, atenna_app_onboarding_seen: true });
  }, FAKE_SESSION);
}

/**
 * Navigate to the fixture page with network mocks for BFF endpoints.
 * Returns the page.
 */
export async function openFixturePage(
  context: BrowserContext,
): Promise<import('@playwright/test').Page> {
  const page = await context.newPage();

  // Mock the BFF /me endpoint so openModal() doesn't redirect to login
  await page.route('**/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ email: 'e2e@atenna.ai', plan: 'free' }),
    })
  );

  // Mock the generate-prompts endpoint
  await page.route('**/generate-prompts', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          direct:     'Prompt direto gerado pelo E2E mock',
          technical:  'Prompt técnico gerado pelo E2E mock',
          structured: 'Prompt estruturado gerado pelo E2E mock',
        },
      }),
    })
  );

  await page.goto(FIXTURE_URL);
  return page;
}

/** Wait for the Atenna badge button to appear in the DOM. */
export async function waitForBadge(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForSelector('#atenna-guard-btn', { timeout: 10_000 });
}
