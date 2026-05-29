/**
 * Diagnostic test — opens real perplexity.ai with the extension loaded,
 * types a CPF, waits for the DLP banner, clicks "Proteger dados",
 * and captures all console logs to reveal exactly what's happening.
 *
 * Run: npx playwright test --project=extension perplexity-debug --headed
 */

import { test, expect, injectSession } from './helpers/extension';

test('DIAG: perplexity.ai — Proteger dados diagnostic', async ({ context }) => {
  // Mock Supabase so fake JWT is accepted
  await context.route('**/auth/v1/user**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ id: 'e2e-diag-id', email: 'diag@atenna.ai' }) })
  );
  await context.route('**/rest/v1/profiles**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([{ display_name: 'Diag' }]) })
  );

  await injectSession(context);
  await new Promise(r => setTimeout(r, 500));

  const page = await context.newPage();

  // Collect all console messages
  const logs: string[] = [];
  page.on('console', msg => {
    const txt = `[${msg.type()}] ${msg.text()}`;
    logs.push(txt);
    if (msg.text().includes('[Atenna')) {
      console.log('  ATENNA LOG:', msg.text());
    }
  });

  await page.goto('https://www.perplexity.ai', { waitUntil: 'domcontentloaded', timeout: 30_000 });

  // Wait for extension badge
  try {
    await page.waitForSelector('#atenna-guard-btn', { timeout: 15_000 });
    console.log('✅ Badge found');
  } catch {
    console.log('❌ Badge NOT found — inspecting DOM...');
    const inputInfo = await page.evaluate(() => {
      const tas = Array.from(document.querySelectorAll('textarea'));
      const ces = Array.from(document.querySelectorAll('[contenteditable="true"]'));
      return {
        textareas: tas.map(t => ({ id: t.id, name: t.name, visible: t.offsetParent !== null, w: t.offsetWidth, placeholder: t.placeholder })),
        contenteditables: ces.map(c => ({ tag: c.tagName, placeholder: c.getAttribute('placeholder') || c.getAttribute('data-placeholder'), visible: (c as HTMLElement).offsetParent !== null })),
      };
    });
    console.log('DOM inputs:', JSON.stringify(inputInfo, null, 2));
    throw new Error('Badge not found — check DOM inspection above');
  }

  // Find the actual input being watched by the extension
  const inputInfo = await page.evaluate(() => {
    const btn = document.getElementById('atenna-guard-btn');
    if (!btn) return null;
    // The badge is positioned near the input — find parent with data-atenna-injected
    const injectedParent = document.querySelector('[data-atenna-injected]');
    const ta = injectedParent?.querySelector('textarea') ?? document.querySelector('textarea');
    const ce = injectedParent?.querySelector('[contenteditable]') ?? document.querySelector('[contenteditable="true"]');
    return {
      injectedParentTag: injectedParent?.tagName,
      textarea: ta ? { id: ta.id, value: ta.value, visible: ta.offsetParent !== null, w: ta.offsetWidth } : null,
      contenteditable: ce ? { tag: ce.tagName, text: (ce as HTMLElement).innerText?.slice(0, 40), visible: (ce as HTMLElement).offsetParent !== null } : null,
    };
  });
  console.log('Input structure:', JSON.stringify(inputInfo, null, 2));

  // Find the right input element
  const inputSel = await page.evaluate(() => {
    const ta = Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea'))
      .find(t => t.offsetParent !== null && t.offsetWidth > 50);
    if (ta) return `textarea (id="${ta.id}", placeholder="${ta.placeholder?.slice(0,30)}")`;
    const ce = document.querySelector<HTMLElement>('[contenteditable="true"]');
    if (ce) return `contenteditable (placeholder="${ce.getAttribute('data-placeholder')?.slice(0,30)}")`;
    return 'none found';
  });
  console.log('Visible input:', inputSel);

  // Type CPF into the input
  const textarea = page.locator('textarea').filter({ visible: true }).first();
  const hasTa = await textarea.count() > 0;

  if (hasTa) {
    await textarea.click();
    await textarea.fill('cpf 05042367466');
    await page.waitForTimeout(600);
  } else {
    const ce = page.locator('[contenteditable="true"]').filter({ visible: true }).first();
    await ce.click();
    await ce.type('cpf 05042367466', { delay: 40 });
    await page.waitForTimeout(600);
  }

  // Wait for DLP banner
  try {
    await page.waitForSelector('#atenna-protection-banner', { timeout: 6_000 });
    console.log('✅ DLP banner appeared');
  } catch {
    console.log('❌ DLP banner did NOT appear');
    console.log('Logs so far:', logs.filter(l => l.includes('Atenna')));
    throw new Error('DLP banner not found');
  }

  // Capture textarea/ce value BEFORE clicking protect
  const valueBefore = await page.evaluate(() => {
    const ta = Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea')).find(t => t.offsetParent !== null && t.offsetWidth > 50);
    if (ta) return { type: 'textarea', value: ta.value };
    const ce = document.querySelector<HTMLElement>('[contenteditable="true"]');
    return { type: 'contenteditable', value: ce?.innerText ?? '' };
  });
  console.log('Value BEFORE protect:', valueBefore);

  // Click protect
  await page.click('.atenna-protection-banner__btn--primary');
  console.log('✅ Clicked Proteger dados');

  await page.waitForTimeout(500);

  // Capture value AFTER
  const valueAfter = await page.evaluate(() => {
    const ta = Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea')).find(t => t.offsetParent !== null && t.offsetWidth > 50);
    if (ta) return { type: 'textarea', value: ta.value };
    const ce = document.querySelector<HTMLElement>('[contenteditable="true"]');
    return { type: 'contenteditable', value: ce?.innerText ?? '' };
  });
  console.log('Value AFTER protect:', valueAfter);

  // Check all Atenna logs collected
  const atennaLogs = logs.filter(l => l.includes('Atenna'));
  console.log('\n=== All Atenna console logs ===');
  atennaLogs.forEach(l => console.log(' ', l));

  // Assertions
  expect(valueAfter.value).toContain('[CPF]');
  expect(valueAfter.value).not.toContain('05042367466');

  await page.waitForTimeout(2000); // keep window open briefly for visual inspection
  await page.close();
});
