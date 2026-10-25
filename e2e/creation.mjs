import { openInput } from './input.mjs';

export async function verifyCreation({ newPage, check, url, outputDir }) {
  for (const width of [390, 1280]) {
    const { page, context } = await newPage({ viewport: { width, height: 900 }, locale: 'en-US' });
    const events = [];
    let exportObserved;
    const observed = new Promise((resolve) => { exportObserved = resolve; });
    await page.route('**/api/creation-events', async (route) => {
      events.push(...route.request().postDataJSON());
      if (events.some((e) => e.name === 'export_completed')) exportObserved();
      await route.fulfill({ status: 204 });
    });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.locator('.creation-guide').waitFor();
    await openInput(page);
    await page.locator('.source-text').fill('PRIVATE_CANARY: Practice retrieval after reading. Spacing learning sessions helps memory. Explain ideas in your own words.');
    await page.locator('.input-sheet .btn-link').filter({ hasText: /Quick layout/i }).click();
    await page.locator('.note-page[data-render-status="ready"]').waitFor({ timeout: 30000 });
    await page.locator('.creation-guide').getByRole('button', { name: 'Export your first image' }).click();
    await page.getByRole('tab', { name: 'Export', exact: true }).waitFor();
    const download = page.waitForEvent('download');
    await page.locator('#tabpanel-export .btn-primary').click();
    await download;
    await page.waitForFunction(() => localStorage.getItem('ink-scribe:creation-success') === '1');
    check(`FC-${width}-guide`, 'First-own-work guide dismisses only after successful image handoff', await page.locator('.creation-guide').count() === 0);
    await page.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth);
    await page.screenshot({ path: `${outputDir}/creation-${width}.png`, fullPage: true });
    // pagehide flushes the bounded in-memory queue; do not depend on a timer delay.
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    let deadline;
    try {
      await Promise.race([observed, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Export event missing')), 10000); })]);
    } finally { clearTimeout(deadline); }
    const names = events.map((e) => e.name);
    check(`FC-${width}-events`, 'Own creation emits one ordered funnel without content',
      ['creation_started', 'generation_started', 'generation_completed', 'note_ready', 'export_completed'].every((name) => names.filter((n) => n === name).length === 1)
      && new Set(events.map((e) => e.creationId)).size === 1 && !JSON.stringify(events).includes('PRIVATE_CANARY'));
    await page.reload({ waitUntil: 'networkidle' });
    check(`FC-${width}-restore`, 'Reload restores work without reopening onboarding', await page.locator('.creation-guide').count() === 0 && await page.locator('.note-page').count() === 1);
    await context.close();
  }
  const { page, context } = await newPage({ locale: 'en-US' }, () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'ink-scribe:creation-success') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.route('**/api/creation-events', (route) => route.abort());
  await page.goto(url, { waitUntil: 'networkidle' });
  await openInput(page);
  await page.locator('.source-text').fill('A failed statistics endpoint must not interfere with saving this note.');
  await page.locator('.input-sheet .btn-link').filter({ hasText: /Quick layout/i }).click();
  await page.locator('.note-page[data-render-status="ready"]').waitFor({ timeout: 30000 });
  await page.locator('.library-bar button').first().click();
  await page.locator('[data-library-status="linked"]').waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  check('FC-offline-stats', 'Blocked statistics do not prevent library persistence', await page.locator('[data-library-status="linked"]').count() === 1);
  await page.locator('.creation-guide').waitFor({ state: 'hidden' });
  check('FC-quota-guide', 'Successful saving dismisses guidance even when its marker cannot persist', await page.evaluate(() => localStorage.getItem('ink-scribe:creation-success')) === null);
  await context.close();
}
