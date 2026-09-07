import { test, expect } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test.beforeEach(async ({ page }) => {
  // The offline application must stay usable without the optional web fonts.
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
});

async function loadFreshBuild(page) {
  await page.evaluate(() => {
    const id = Persist.create(Actions.newBuild('Layout test vessel'));
    App.loadBuild(id);
  });
}

async function expectContained(page, label) {
  const sizes = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    overflowing: [...document.body.querySelectorAll('*')]
      .filter(element => (element.getBoundingClientRect().right > document.documentElement.clientWidth || element.scrollWidth > element.clientWidth) && !element.closest('.tblwrap'))
      .map(element => ({ tag: element.tagName, id: element.id, class: element.className, width: element.getBoundingClientRect().width, scroll: element.scrollWidth, overflow: getComputedStyle(element).overflow }))
      .slice(0, 30),
  }));
  expect(sizes.document, `${label}: document width; overflow ${JSON.stringify(sizes.overflowing)}`).toBeLessThanOrEqual(sizes.viewport);
  expect(sizes.body, `${label}: body width`).toBeLessThanOrEqual(sizes.viewport);
  const hull = await page.locator('#hullSel').boundingBox();
  expect(hull.x, `${label}: hull left edge`).toBeGreaterThanOrEqual(0);
  expect(hull.x + hull.width, `${label}: hull right edge`).toBeLessThanOrEqual(sizes.viewport);
  for (const selector of ['#exportBtn', '#undoBtn', '#themeBtn', '#helpBtn']) {
    const bounds = await page.locator(selector).boundingBox();
    expect(bounds.x, `${label}: ${selector} left edge`).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width, `${label}: ${selector} right edge`).toBeLessThanOrEqual(sizes.viewport);
  }
}

test('F8 uses standards mode and mobile document metadata', async ({ page }) => {
  await page.goto('./');
  expect(await page.evaluate(() => document.compatMode)).toBe('CSS1Compat');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', 'width=device-width, initial-scale=1');
});

test('F8 contains native select overflow and preserves its keyboard focus indicator', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.goto('./');
  // Linux WebKit keeps overflow visible on native selects regardless of the authored value.
  await page.addStyleTag({ content: '#hdr select { overflow: visible !important; }' });
  await expectContained(page, 'native select overflow');
  await page.locator('#buildName').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#hullSel')).toBeFocused();
  const focus = page.locator('.select-wrap').filter({ has: page.locator('#hullSel') });
  await expect(focus).toHaveCSS('outline-style', 'solid');
  await expect(focus).toHaveCSS('outline-width', '2px');
  await page.locator('#hullSel').selectOption('jericho');
  await expect(page.locator('#hullSel')).toHaveValue('jericho');
  expect(await page.evaluate(() => Store.build.hull)).toBe('jericho');
  await expectContained(page, 'native select hull change');
});

test('F8 applies the viewport in a touch mobile browser', async ({ browser, baseURL }, testInfo) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  try {
    await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
    const mobile = await context.newPage();
    await mobile.goto('./');
    await loadFreshBuild(mobile);
    expect(await mobile.evaluate(() => ({
      innerWidth: window.innerWidth,
      clientWidth: document.documentElement.clientWidth,
    }))).toEqual({ innerWidth: 390, clientWidth: 390 });
    await expectContained(mobile, 'touch mobile viewport');
    await mobile.locator('#hullSel').selectOption('sword');
    await expect(mobile.locator('#hullSel')).toHaveValue('sword');
    expect(await mobile.evaluate(() => Store.build.hull)).toBe('sword');
    await expectContained(mobile, 'touch mobile hull change');
    await mobile.locator('.opts summary').tap();
    await expect(mobile.locator('.opts')).toHaveAttribute('open', '');
    await expectContained(mobile, 'touch mobile options');
    await mobile.screenshot({ path: testInfo.outputPath('mobile-390.png') });
  } finally {
    await context.close();
  }
});

for (const viewport of [{ width: 320, height: 568 }, { width: 640, height: 360 }, { width: 650, height: 360 }]) {
  test(`expanded options leave the editor usable at ${viewport.width}x${viewport.height}`, async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ baseURL, viewport, isMobile: true, hasTouch: true });
    try {
      await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
      const mobile = await context.newPage();
      await mobile.goto('./');
      await loadFreshBuild(mobile);
      await mobile.locator('.opts summary').tap();
      await mobile.locator('#manualW').tap();
      await expect(mobile.locator('#manualW')).toBeChecked();
      await mobile.locator('#addSpMod').tap();
      await expect(mobile.locator('.sprow')).toHaveCount(1);

      // Scrolling must expose an actionable component button while options stay open.
      const change = mobile.locator('[data-pick="bridge"]');
      await change.scrollIntoViewIfNeeded();
      await change.tap({ timeout: 5000 });
      await expect(mobile.locator('#picker')).toBeVisible();
      await mobile.locator('[data-comp="armoured_bridge"] [data-add]').tap();
      await expect(mobile.locator('#picker')).toBeHidden();
      expect(await mobile.evaluate(() => Store.build.essentials.bridge)).toBe('armoured_bridge');
      await mobile.screenshot({ path: testInfo.outputPath('short-screen-component.png') });

      // Returning to the expanded header must keep its lower controls reachable too.
      await mobile.locator('.sprow .cause').tap();
      await mobile.locator('.sprow .cause').fill('GM grant');
      await mobile.locator('.sprow .cause').blur();
      await mobile.locator('.sprow .val').tap();
      await mobile.locator('.sprow .val').fill('5');
      await mobile.locator('.sprow .val').blur();
      expect(await mobile.evaluate(() => Store.build.spMods[0])).toMatchObject({ cause: 'GM grant', value: 5 });
      await mobile.locator('#addSpMod').tap();
      await expect(mobile.locator('.sprow')).toHaveCount(2);
      await mobile.locator('[data-rmspmod]').last().tap();
      await expect(mobile.locator('.sprow')).toHaveCount(1);
      await mobile.screenshot({ path: testInfo.outputPath('short-screen-options.png') });
      await mobile.locator('.opts summary').tap();
      await expect(mobile.locator('.opts')).not.toHaveAttribute('open');
    } finally {
      await context.close();
    }
  });
}

test('component previews follow mouse hover and keyboard navigation', async ({ page }) => {
  await page.goto('./');
  await loadFreshBuild(page);
  await page.locator('[data-pick="bridge"]').click();
  const armoured = page.locator('[data-comp="armoured_bridge"]');
  const summary = page.locator('.pk-summary');
  await armoured.hover();
  await expect(summary).toHaveText('If installed: Tech-Use repair -10');
  await page.locator('#pkClose').hover();
  await expect(summary).toBeEmpty();

  await page.locator('#pkFree').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-comp="combat_bridge"]')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(summary).toContainText('Command +5');
  await page.keyboard.press('ArrowDown');
  await expect(armoured).toBeFocused();
  await expect(summary).toHaveText('If installed: Tech-Use repair -10');
  expect(await page.evaluate(() => Store.build.essentials.bridge)).toBe('combat_bridge');
});

for (const width of [320, 390, 640, 1280]) {
  test(`F8 keeps editor controls within ${width}px across expanded and modal states`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('./');
    await loadFreshBuild(page);
    await expect(page.locator('#hullSel')).toBeVisible();
    await expectContained(page, 'initial');
    await page.screenshot({ path: testInfo.outputPath(`editor-${width}.png`), fullPage: true });
    await page.locator('#hullSel').selectOption('sword');
    await expect(page.locator('#hullSel')).toHaveValue('sword');
    expect(await page.evaluate(() => Store.build.hull)).toBe('sword');
    await expect.poll(() => page.evaluate(() => Persist.mem.builds[Persist.mem.activeId].build.hull)).toBe('sword');

    await page.locator('.opts summary').click();
    await expectContained(page, 'options');
    await page.locator('#manualW').check();
    await page.locator('#pfIn').fill('0');
    await page.locator('#pfIn').press('Tab');
    await page.locator('#addSpMod').click();
    await page.locator('.sprow .cause').fill('VeryLongAdjustmentCause'.repeat(4));
    await page.locator('.sprow .cause').press('Tab');
    await expectContained(page, 'manual warrant and adjustment');
    for (const selector of ['#pfIn', '#spIn', '.sprow .cause', '.sprow .val']) {
      const bounds = await page.locator(selector).boundingBox();
      expect(bounds.x + bounds.width, `${selector} stays visible`).toBeLessThanOrEqual(width);
      expect(bounds.width, `${selector} remains operable`).toBeGreaterThan(24);
    }
    await page.screenshot({ path: testInfo.outputPath(`options-${width}.png`), fullPage: true });
    await page.locator('.opts summary').click();

    await page.locator('#buildName').fill('LongUnbrokenVesselName'.repeat(6));
    await page.locator('#buildName').press('Tab');
    await expectContained(page, 'long saved name');
    await page.locator('#bkRestore').click();
    await expectContained(page, 'backup restoration');
    await page.locator('#bkRestore').click();
    await page.locator('#importCode').click();
    await expectContained(page, 'share import');
    await page.locator('#importCode').click();

    await page.locator('[data-pick="plasma_drive"]').click();
    await expect(page.locator('#picker')).toBeVisible();
    await expectContained(page, 'component picker');
    const picker = await page.locator('#picker').boundingBox();
    expect(picker.x).toBeGreaterThanOrEqual(0);
    expect(picker.x + picker.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`picker-${width}.png`) });
    await page.keyboard.press('Escape');

    await page.locator('#newBuild').click();
    await page.locator('[data-cmp]').nth(0).check();
    await page.locator('[data-cmp]').nth(1).check();
    await page.locator('#cmpBtn').click();
    await expect(page.locator('#sheet h2')).toHaveText('Compare builds');
    await expectContained(page, 'comparison');
    const comparison = await page.locator('.cmp').boundingBox();
    expect(comparison.width, 'comparison columns stay readable').toBeGreaterThanOrEqual(560);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`comparison-${width}.png`), fullPage: true });
  });
}

test('offline file opens and print export renders the dossier', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const root = process.env.SITE_ROOT || path.resolve('_site');
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await expect(page.locator('#hullSel')).toBeVisible();
  const name = await page.locator('#buildName').inputValue();
  await page.locator('#exportBtn').click();
  await expect(page.locator('#export .sheet h1')).toHaveText(name);
  await page.evaluate(() => {
    window.__printCalls = 0;
    window.print = () => { window.__printCalls += 1; };
  });
  await page.locator('#exPrint').click();
  expect(await page.evaluate(() => window.__printCalls)).toBe(1);
  await expect(page.locator('#printsheet .sheet h1')).toHaveText(name);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#printsheet')).toBeVisible();
  await expect(page.locator('#hdr')).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({ media: 'screen' });
  await expect(page.locator('#export')).toBeVisible();
  expect(errors).toEqual([]);
});
