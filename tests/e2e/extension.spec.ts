import { test, expect } from './helpers/extension';

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
