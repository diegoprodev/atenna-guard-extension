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
      testMatch: /tests\/e2e\/(extension|welcome|full-flow|validation-full)\.spec\.ts/,
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
        baseURL: 'https://api.atennaia.com.br',
      },
    },
    {
      // Extensão (welcome.html) contra o backend REAL — sem mocks. Cria usuários
      // de teste no Supabase (prefixo e2e-welcome-*). Rodar sob demanda:
      //   npx playwright test --project=welcome-real
      name: 'welcome-real',
      testMatch: /tests\/e2e\/welcome-real-backend\.spec\.ts/,
      use: {},
    },
  ],
});
