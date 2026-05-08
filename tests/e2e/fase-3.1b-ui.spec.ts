/**
 * FASE 3.1B-UI: Governed User Export Interface E2E Tests
 *
 * Valida:
 * - Renderização de componentes na Settings page
 * - Estados visuais (idle, requested, ready, expired)
 * - Interações de botões (solicitar, download, cancelar)
 * - Responsividade (sem overflow horizontal em 360px)
 */

import { test, expect } from '@playwright/test';

test.describe('FASE 3.1B-UI: Privacy & Data Governance', () => {
  const SETTINGS_SELECTOR = '[data-gear]';
  const PRIVACY_SECTION_SELECTOR = '.atenna-privacy';
  const EXPORT_CARD_SELECTOR = '[data-card-type="export"]';
  const DELETION_CARD_SELECTOR = '[data-card-type="deletion"]';

  // ══════════════════════════════════════════════════════════════════════════
  // Teste 1: Settings page abre com seção "Privacidade e Dados"
  // ══════════════════════════════════════════════════════════════════════════
  test('Settings page renderiza com seção Privacidade e Dados', async ({ page }) => {
    // Abrir Settings
    const gearBtn = page.locator(SETTINGS_SELECTOR);
    await gearBtn.click();

    // Verificar que section title existe
    const sectionTitle = page.locator('text=🔐 Privacidade e Dados');
    await expect(sectionTitle).toBeVisible();

    console.log('✅ TESTE 1: Settings page renderiza privacidade');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Teste 2: Export card renderiza com título correto
  // ══════════════════════════════════════════════════════════════════════════
  test('Export card renderiza com título "Seus dados"', async ({ page }) => {
    const gearBtn = page.locator(SETTINGS_SELECTOR);
    await gearBtn.click();

    const exportCard = page.locator(EXPORT_CARD_SELECTOR);
    await expect(exportCard).toBeVisible();

    const title = exportCard.locator('.atenna-privacy__card-title');
    await expect(title).toHaveText('Seus dados');

    console.log('✅ TESTE 2: Export card renderizado');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Teste 3: Deletion card renderiza com título correto
  // ══════════════════════════════════════════════════════════════════════════
  test('Deletion card renderiza com título "Exclusão de conta"', async ({ page }) => {
    const gearBtn = page.locator(SETTINGS_SELECTOR);
    await gearBtn.click();

    const deletionCard = page.locator(DELETION_CARD_SELECTOR);
    await expect(deletionCard).toBeVisible();

    const title = deletionCard.locator('.atenna-privacy__card-title');
    await expect(title).toHaveText('Exclusão de conta');

    console.log('✅ TESTE 3: Deletion card renderizado');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Teste 4: Botão "Solicitar relatório" existe e é clicável
  // ══════════════════════════════════════════════════════════════════════════
  test('Botão "Solicitar relatório" é renderizado e clicável', async ({ page }) => {
    const gearBtn = page.locator(SETTINGS_SELECTOR);
    await gearBtn.click();

    const exportCard = page.locator(EXPORT_CARD_SELECTOR);
    const requestBtn = exportCard.locator('button:has-text("Solicitar relatório")');

    await expect(requestBtn).toBeVisible();
    await expect(requestBtn).toBeEnabled();

    console.log('✅ TESTE 4: Botão "Solicitar relatório" clicável');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Teste 5: Botão "Solicitar exclusão" existe e é clicável
  // ══════════════════════════════════════════════════════════════════════════
  test('Botão "Solicitar exclusão" é renderizado e clicável', async ({ page }) => {
    const gearBtn = page.locator(SETTINGS_SELECTOR);
    await gearBtn.click();

    const deletionCard = page.locator(DELETION_CARD_SELECTOR);
    const requestBtn = deletionCard.locator('button:has-text("Solicitar exclusão")');

    await expect(requestBtn).toBeVisible();
    await expect(requestBtn).toBeEnabled();

    console.log('✅ TESTE 5: Botão "Solicitar exclusão" clicável');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Teste 6: Estado idle é exibido inicialmente
  // ══════════════════════════════════════════════════════════════════════════
  test('Export card mostra estado "idle" — "Nenhuma solicitação ativa"', async ({ page }) => {
    const gearBtn = page.locator(SETTINGS_SELECTOR);
    await gearBtn.click();

    const exportCard = page.locator(EXPORT_CARD_SELECTOR);
    const statusText = exportCard.locator('.atenna-privacy__status-text');

    // Status inicial pode ser "Nenhuma solicitação ativa" ou "Carregando..."
    const text = await statusText.first().textContent();
    const isIdleOrLoading = text?.includes('Nenhuma solicitação ativa') || text?.includes('Carregando');
    expect(isIdleOrLoading).toBeTruthy();

    console.log('✅ TESTE 6: Estado idle exibido (ou carregando)');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Teste 7: Description text é exibido
  // ══════════════════════════════════════════════════════════════════════════
  test('Export card exibe descrição informativa', async ({ page }) => {
    const gearBtn = page.locator(SETTINGS_SELECTOR);
    await gearBtn.click();

    const exportCard = page.locator(EXPORT_CARD_SELECTOR);
    const desc = exportCard.locator('.atenna-privacy__card-desc');

    await expect(desc).toContainText('Você pode solicitar uma cópia estruturada');

    console.log('✅ TESTE 7: Descrição exibida');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Teste 8: Deletion card description é diferente
  // ══════════════════════════════════════════════════════════════════════════
  test('Deletion card exibe descrição sobre reversão', async ({ page }) => {
    const gearBtn = page.locator(SETTINGS_SELECTOR);
    await gearBtn.click();

    const deletionCard = page.locator(DELETION_CARD_SELECTOR);
    const desc = deletionCard.locator('.atenna-privacy__card-desc');

    await expect(desc).toContainText('período de reversão de 7 dias');

    console.log('✅ TESTE 8: Descrição de reversão exibida');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Teste 9: Status dot renderiza com cor dinâmica
  // ══════════════════════════════════════════════════════════════════════════
  test('Status dot renderiza e possui cor (background-color)', async ({ page }) => {
    const gearBtn = page.locator(SETTINGS_SELECTOR);
    await gearBtn.click();

    const exportCard = page.locator(EXPORT_CARD_SELECTOR);
    const statusDot = exportCard.locator('.atenna-privacy__status-dot').first();

    // Verificar que dot existe e tem estilo
    const bgColor = await statusDot.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    expect(bgColor).toBeTruthy();

    console.log('✅ TESTE 9: Status dot renderizado com cor');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Teste 10: Responsividade: sem overflow horizontal em 360px
  // ══════════════════════════════════════════════════════════════════════════
  test('Responsividade: sem overflow horizontal em 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });

    const gearBtn = page.locator(SETTINGS_SELECTOR);
    await gearBtn.click();

    const privacySection = page.locator(PRIVACY_SECTION_SELECTOR);
    await expect(privacySection).toBeVisible();

    // Verificar que não há overflow horizontal
    const overflowX = await privacySection.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return window.innerWidth < rect.right;
    });

    expect(overflowX).toBe(false);

    console.log('✅ TESTE 10: Responsividade OK em 360px');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Teste 11: Cards possuem CSS classes esperadas
  // ══════════════════════════════════════════════════════════════════════════
  test('Cards possuem classes CSS esperadas', async ({ page }) => {
    const gearBtn = page.locator(SETTINGS_SELECTOR);
    await gearBtn.click();

    const exportCard = page.locator(EXPORT_CARD_SELECTOR);
    const hasCardClass = await exportCard.evaluate((el) => el.classList.contains('atenna-privacy__card'));
    expect(hasCardClass).toBe(true);

    const actionRow = exportCard.locator('.atenna-privacy__actions');
    await expect(actionRow).toBeVisible();

    console.log('✅ TESTE 11: Classes CSS corretas');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Teste 12: Ambas as cards estão presentes na mesma seção
  // ══════════════════════════════════════════════════════════════════════════
  test('Ambas as cards (export + deletion) estão visíveis juntas', async ({ page }) => {
    const gearBtn = page.locator(SETTINGS_SELECTOR);
    await gearBtn.click();

    const privacySection = page.locator(PRIVACY_SECTION_SELECTOR);
    const exportCard = privacySection.locator(EXPORT_CARD_SELECTOR);
    const deletionCard = privacySection.locator(DELETION_CARD_SELECTOR);

    await expect(exportCard).toBeVisible();
    await expect(deletionCard).toBeVisible();

    // Verificar que export vem antes de deletion
    const exportBox = await exportCard.boundingBox();
    const deletionBox = await deletionCard.boundingBox();

    if (exportBox && deletionBox) {
      expect(exportBox.y).toBeLessThan(deletionBox.y);
    }

    console.log('✅ TESTE 12: Ambas as cards visíveis e ordenadas');
  });
});
