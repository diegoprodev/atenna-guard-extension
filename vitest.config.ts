import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: [
      'node_modules',
      'dist',
      '.idea',
      '.git',
      '.cache',
      'tests/e2e/**/*.spec.ts', // E2E tests run with Playwright, not Vitest
    ],
  },
});
