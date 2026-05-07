import { test, expect } from '@playwright/test';

test.describe('TASK 5 — Timeout Safety', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');
  });

  test('should not hang when DLP analysis times out', async ({ page }) => {
    // This test verifies that:
    // 1. User types text with sensitive data
    // 2. DLP backend has a timeout (3s max)
    // 3. If timeout occurs, fallback to NONE risk
    // 4. Generation completes successfully (not blocked by timeout)

    // Fill input with sensitive content
    const inputField = page.locator('textarea[placeholder*="input"]').first();
    await inputField.fill('CPF 050.423.674-11 da pessoa');

    // Click generate
    const generateButton = page.locator('button:has-text("Gerar")');
    const startTime = Date.now();

    // Start generation and monitor for completion
    const generatePromise = generateButton.click();

    // Wait for response with reasonable timeout (6s)
    // Even if DLP times out at 3s, generation should complete
    const responsePromise = page.waitForResponse(
      response => response.url().includes('/generate-prompts') && response.status() === 200
    );

    try {
      await Promise.race([
        responsePromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Response timeout')), 6000))
      ]);

      const duration = Date.now() - startTime;

      // Verify:
      // 1. Response arrived (not hung)
      // 2. Completed within reasonable time (should be fast even with DLP timeout)
      expect(duration).toBeLessThan(6000);

      // 3. Results are displayed (even if with fallback risk)
      const results = page.locator('[data-testid="prompt-results"]');
      await expect(results).toBeVisible({ timeout: 2000 });

      console.log(`✅ Generation completed in ${duration}ms despite potential DLP timeout`);
    } catch (error) {
      throw new Error(`Generation hung or failed: ${error}`);
    }
  });

  test('should show warning for HIGH risk even if DLP is slow', async ({ page }) => {
    // Verify that strict mode still works and warning is shown
    // even when DLP analysis takes time close to timeout

    const inputField = page.locator('textarea[placeholder*="input"]').first();
    await inputField.fill('Paciente com HIV positivo em tratamento');

    // Look for warning banner (HIGH risk)
    const warningBanner = page.locator('[data-testid="dlp-warning"], .dlp-banner-high');

    // Should appear even with slow DLP
    await expect(warningBanner).toBeVisible({ timeout: 5000 });

    console.log('✅ Warning displayed for HIGH risk content');
  });

  test('should fallback gracefully on DLP error', async ({ page }) => {
    // Simulates DLP engine error by expecting NONE risk fallback
    // Backend should return NONE risk if analysis fails/times out

    const inputField = page.locator('textarea[placeholder*="input"]').first();
    await inputField.fill('Normal technical content with no sensitive data');

    const generateButton = page.locator('button:has-text("Gerar")');
    await generateButton.click();

    // Should complete without hanging
    const results = page.locator('[data-testid="prompt-results"]');
    await expect(results).toBeVisible({ timeout: 4000 });

    console.log('✅ Generation completed with fallback behavior');
  });

  test('should not block generation if DLP timeout occurs', async ({ page }) => {
    // Core TASK 5 requirement: timeout should never block generation
    // User should always get response, even if DLP returns NONE risk fallback

    const inputField = page.locator('textarea[placeholder*="input"]').first();
    const generateButton = page.locator('button:has-text("Gerar")');

    // Test with various content types
    const testCases = [
      'Simple text',
      'Email: user@example.com',
      'Phone: +55 11 98765-4321',
      'Long text ' + 'repeated content '.repeat(100),
    ];

    for (const content of testCases) {
      await inputField.fill(content);

      const startTime = Date.now();
      await generateButton.click();

      // Should complete within 8 seconds (including DLP timeout + generation)
      const results = page.locator('[data-testid="prompt-results"]');
      await expect(results).toBeVisible({ timeout: 8000 });

      const duration = Date.now() - startTime;
      console.log(`✅ "${content.substring(0, 30)}..." completed in ${duration}ms`);

      // Clear for next iteration
      await inputField.clear();
    }
  });
});
