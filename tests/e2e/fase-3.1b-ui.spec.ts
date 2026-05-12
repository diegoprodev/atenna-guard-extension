import { test, expect } from '@playwright/test';

test.describe('FASE 3.1B — Privacy & Data Governance UI', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to extension page
    await page.goto('chrome-extension://placeholder/popup.html');
    
    // Mock authenticated session
    await page.evaluate(() => {
      localStorage.setItem('atenna_jwt', JSON.stringify({
        email: 'test@example.com',
        access_token: 'mock_token_xyz',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }));
    });
  });

  test('1. Settings page opens with "Privacidade e Dados" section', async ({ page }) => {
    const settingsBtn = page.locator('[data-testid="settings-button"]');
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();

    const privacySection = page.locator('.atenna-privacy');
    await expect(privacySection).toBeVisible();

    const sectionTitle = page.locator('text=Privacidade e Dados');
    await expect(sectionTitle).toBeVisible();
  });

  test('2. Export card renders with correct title', async ({ page }) => {
    await page.locator('[data-testid="settings-button"]').click();

    const exportCard = page.locator('.atenna-privacy__card').first();
    const title = exportCard.locator('.atenna-privacy__card-title');
    
    await expect(title).toHaveText('Seus dados');
  });

  test('3. Deletion card renders with correct title', async ({ page }) => {
    await page.locator('[data-testid="settings-button"]').click();

    const deletionCard = page.locator('.atenna-privacy__card').nth(1);
    const title = deletionCard.locator('.atenna-privacy__card-title');
    
    await expect(title).toHaveText('Exclusão de conta');
  });

  test('4. "Solicitar relatório" button exists and is clickable', async ({ page }) => {
    await page.locator('[data-testid="settings-button"]').click();

    const exportBtn = page.locator('button:has-text("Solicitar relatório")');
    await expect(exportBtn).toBeVisible();
    await expect(exportBtn).toBeEnabled();
  });

  test('5. "Solicitar exclusão" button exists and is clickable', async ({ page }) => {
    await page.locator('[data-testid="settings-button"]').click();

    const deletionBtn = page.locator('button:has-text("Solicitar exclusão")').first();
    await expect(deletionBtn).toBeVisible();
    await expect(deletionBtn).toBeEnabled();
  });

  test('6. Export card shows idle status initially', async ({ page }) => {
    await page.locator('[data-testid="settings-button"]').click();

    const exportCard = page.locator('.atenna-privacy__card').first();
    const statusText = exportCard.locator('[data-export-status]');
    
    await expect(statusText).toContainText('Nenhuma solicitação ativa');
  });

  test('7. Export card shows "requested" state after clicking button', async ({ page }) => {
    await page.route('**/user/export/status', async route => {
      if (route.request().method() === 'GET') {
        await route.abort();
      } else {
        await route.continue();
      }
    });

    await page.locator('[data-testid="settings-button"]').click();

    const exportCard = page.locator('.atenna-privacy__card').first();
    const requestBtn = exportCard.locator('button:has-text("Solicitar relatório")');
    
    // Mock backend response for request
    await page.route('**/user/export/request', async route => {
      await route.respond({
        status: 200,
        body: JSON.stringify({
          success: true,
          message: 'Email de confirmação enviado',
        }),
      });
    });

    await requestBtn.click();
    
    // After request, should show email confirmation state
    const statusText = exportCard.locator('[data-export-status]');
    await expect(statusText).toContainText('Confirmação enviada');
  });

  test('8. Export card shows "ready" state with download button', async ({ page }) => {
    // Mock backend response for ready status
    await page.route('**/user/export/status', async route => {
      await route.respond({
        status: 200,
        body: JSON.stringify({
          has_pending_request: true,
          status: 'ready',
          expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
          download_count: 3,
          max_downloads: 3,
        }),
      });
    });

    await page.locator('[data-testid="settings-button"]').click();

    const exportCard = page.locator('.atenna-privacy__card').first();
    const statusText = exportCard.locator('[data-export-status]');
    
    await expect(statusText).toContainText('Relatório disponível');

    const downloadBtn = exportCard.locator('button:has-text("Fazer download")');
    await expect(downloadBtn).toBeVisible();
  });

  test('9. Export card shows "expired" state with new request button', async ({ page }) => {
    await page.route('**/user/export/status', async route => {
      await route.respond({
        status: 200,
        body: JSON.stringify({
          has_pending_request: true,
          status: 'expired',
          expires_at: new Date(Date.now() - 1000).toISOString(),
        }),
      });
    });

    await page.locator('[data-testid="settings-button"]').click();

    const exportCard = page.locator('.atenna-privacy__card').first();
    const statusText = exportCard.locator('[data-export-status]');
    
    await expect(statusText).toContainText('Este relatório expirou');

    const newBtn = exportCard.locator('button:has-text("Solicitar novo")');
    await expect(newBtn).toBeVisible();
  });

  test('10. Deletion card shows grace period days remaining', async ({ page }) => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 5);

    await page.route('**/user/deletion/status', async route => {
      await route.respond({
        status: 200,
        body: JSON.stringify({
          has_pending_request: true,
          status: 'deletion_scheduled',
          deletion_scheduled_at: futureDate.toISOString(),
          grace_period_remaining_days: 5,
        }),
      });
    });

    await page.locator('[data-testid="settings-button"]').click();

    const deletionCard = page.locator('.atenna-privacy__card').nth(1);
    const statusText = deletionCard.locator('[data-deletion-status]');
    
    await expect(statusText).toContainText('Exclusão agendada');
    await expect(statusText).toContainText('dias para cancelar');
  });

  test('11. "Cancelar solicitação" button appears in grace period', async ({ page }) => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 3);

    await page.route('**/user/deletion/status', async route => {
      await route.respond({
        status: 200,
        body: JSON.stringify({
          has_pending_request: true,
          status: 'deletion_scheduled',
          deletion_scheduled_at: futureDate.toISOString(),
          grace_period_remaining_days: 3,
        }),
      });
    });

    await page.locator('[data-testid="settings-button"]').click();

    const deletionCard = page.locator('.atenna-privacy__card').nth(1);
    const cancelBtn = deletionCard.locator('button:has-text("Cancelar solicitação")');
    
    await expect(cancelBtn).toBeVisible();
    await expect(cancelBtn).toBeEnabled();
  });

  test('12. Privacy section has no horizontal overflow (responsive)', async ({ page }) => {
    // Set viewport to mobile width
    await page.setViewportSize({ width: 360, height: 600 });

    await page.locator('[data-testid="settings-button"]').click();

    const privacySection = page.locator('.atenna-privacy');
    const boundingBox = await privacySection.boundingBox();

    // Ensure no overflow
    expect(boundingBox?.width).toBeLessThanOrEqual(360);
  });
});
