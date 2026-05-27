import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['html', { open: 'never' }]],
  timeout: 30_000,

  webServer: {
    command: 'npx http-server tests/e2e/fixtures -p 4200 -c-1 --silent',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },

  projects: [
    {
      name: 'extension',
      testMatch: /tests\/e2e\/(extension|welcome)\.spec\.ts/,
      use: {},
    },
    {
      name: 'stress',
      testMatch: /tests\/e2e\/stress-full-flow\.spec\.ts/,
      use: {},
    },
    {
      name: 'api',
      testMatch: /tests\/e2e\/(fase-5\.1|fase-4\.2a).*\.spec\.ts/,
      use: {
        baseURL: 'https://atennaplugin.maestro-n8n.site',
      },
    },
  ],
});
