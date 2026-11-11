import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.CAGE_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.CAGE_SITE_URL || 'http://127.0.0.1:4822/Claude-Cage/';
const output = process.env.CAGE_SITE_REPORT || '_output/docs-website-20261107/shots';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.locator('header nav').getByRole('link', { name: 'Documentation', exact: true }).click();
    await page.getByRole('heading', { level: 1, name: 'Start here' }).waitFor();
    assert.equal(await page.locator('body').evaluate(body => body.scrollWidth <= innerWidth + 1), true, `${width}: guide overflows`);
    await page.screenshot({ path: `${output}/guide-${width}.png` });
    const search = page.getByRole('searchbox', { name: 'Search the docs' });
    await search.fill('multiple accounts');
    await page.locator('#search-list').getByRole('link', { name: 'Multiple accounts and usage limits', exact: true }).waitFor();
    assert.equal(await page.locator('#guide-article').isVisible(), false);
    await page.screenshot({ path: `${output}/search-${width}.png` });
    await page.locator('#search-list').getByRole('link', { name: 'Multiple accounts and usage limits', exact: true }).click();
    await page.getByRole('heading', { level: 1, name: 'Multiple accounts and usage limits' }).waitFor();
    await page.getByRole('navigation', { name: 'On this page' }).getByRole('link', { name: 'When automatic assignment happens' }).click();
    assert.ok(decodeURIComponent(new URL(page.url()).hash).includes('when-automatic-assignment-happens'));
    await page.reload();
    await page.getByRole('heading', { level: 2, name: 'When automatic assignment happens' }).waitFor();
    await page.screenshot({ path: `${output}/accounts-${width}.png` });
    await search.fill('nonexistent-feature-xyz987');
    await page.getByRole('status').filter({ hasText: 'No matching pages' }).waitFor();
    await page.screenshot({ path: `${output}/empty-${width}.png` });
    await page.getByRole('button', { name: 'Back to the article' }).click();
    assert.equal(await page.locator('#guide-article').isVisible(), true);
    await search.fill('phone pairing');
    await page.locator('#search-list').getByRole('link', { name: 'Phone connection and remote sessions', exact: true }).waitFor();
    await search.press('Escape');
    assert.equal(await search.inputValue(), '');
    if (width === 390) {
      await page.evaluate(() => scrollTo(0, 0));
      const menu = page.locator('.guide-mobile-menu');
      const title = page.locator('.guide-title');
      const before = (await title.boundingBox()).y;
      await menu.locator('summary').focus();
      await page.keyboard.press('Enter');
      assert.ok((await title.boundingBox()).y > before + 250, 'mobile menu must occupy layout space');
      await page.screenshot({ path: `${output}/menu-${width}.png` });
      await page.keyboard.press('Escape');
      assert.equal(await menu.getAttribute('open'), null);
      assert.ok(Math.abs((await title.boundingBox()).y - before) < 2, 'menu must restore layout');
      await menu.locator('summary').press('Enter');
      await menu.getByRole('link', { name: 'Phone connection and remote sessions' }).click();
      await page.getByRole('heading', { level: 1, name: 'Phone connection and remote sessions' }).waitFor();
      assert.equal(await page.locator('body').evaluate(body => body.scrollWidth <= innerWidth + 1), true, 'mobile article overflows');
    } else {
      // At browser zoom 200%, a 1280px window exposes a 640px CSS viewport.
      await page.setViewportSize({ width: 640, height: 450 });
      await page.evaluate(() => scrollTo(0, 0));
      assert.equal(await page.locator('body').evaluate(body => body.scrollWidth <= innerWidth + 1), true, '200% zoom overflows');
      await page.screenshot({ path: `${output}/zoom-200.png` });
    }
    await page.close();
  }
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(new URL('docs/', origin).href);
  await page.getByRole('heading', { level: 1, name: 'Start here' }).waitFor();
  assert.equal(await page.locator('.guide-search').isVisible(), false);
  await page.locator('.guide-mobile-menu summary').click();
  await page.locator('.guide-mobile-menu').getByRole('link', { name: 'Troubleshooting', exact: true }).click();
  await page.getByRole('heading', { level: 1, name: 'Troubleshooting' }).waitFor();
  await page.screenshot({ path: `${output}/no-javascript.png` });
  await context.close();
  assert.deepEqual(errors, []);
  console.log('PASS: homepage entry, desktop/mobile guide, full-text search, no results/recovery, cross-page and hash navigation, inline mobile menu keyboard/layout, 200% zoom, no-JavaScript reading');
} finally { await browser.close(); }
