import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const KEY = 'voidship-builder:v1';
const RECOVERY = 'voidship-builder:recovery:';

test.beforeEach(async ({ page }) => {
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.goto('./');
});

async function storedFixture(page, change) {
  return page.evaluate(({ key, change }) => {
    App.flushSave();
    const saved = JSON.parse(localStorage.getItem(key));
    const build = saved.builds[saved.activeId].build;
    if (change === 'legacy') delete build.spMods;
    if (change === 'invalid') build.warrant.pf = 'invalid profit factor';
    if (change === 'removed') build.supplementals.push({ uid: 'old_component', id: 'component_from_an_old_catalogue' });
    const raw = JSON.stringify(saved);
    localStorage.setItem(key, raw);
    return raw;
  }, { key: KEY, change });
}

test('missing optional SP adjustments migrate without a recovery warning or archive', async ({ page }) => {
  await storedFixture(page, 'legacy');
  for (let reload = 0; reload < 2; reload++) {
    await page.reload();
    expect(await page.evaluate(() => Store.build.spMods)).toEqual([]);
    expect(await page.evaluate(prefix => Object.keys(localStorage).filter(key => key.startsWith(prefix)), RECOVERY)).toEqual([]);
    await expect(page.locator('#recoveryNotice')).toHaveCount(0);
  }
});

test('a weapon deliberately left without a slot reloads without false recovery', async ({ page }) => {
  await page.evaluate(() => {
    const weapon = Store.build.supplementals.find(item => item.slot);
    Store.dispatch({ type: 'moveWeapon', uid: weapon.uid, slot: null });
    App.flushSave();
  });
  await page.reload();
  expect(await page.evaluate(() => Store.build.supplementals[0].slot ?? null)).toBeNull();
  expect(await page.evaluate(prefix => Object.keys(localStorage).filter(key => key.startsWith(prefix)), RECOVERY)).toEqual([]);
  await expect(page.locator('#recoveryNotice')).toHaveCount(0);
});

test('an identical retained original permits recovery when a new archive would exceed quota', async ({ page }) => {
  const raw = await storedFixture(page, 'invalid');
  const archiveKey = RECOVERY + '1000-existing';
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: archiveKey, raw });
  await page.addInitScript(prefix => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (String(key).startsWith(prefix)) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  }, RECOVERY);
  await page.reload();
  expect(await page.evaluate(() => ({ blocked: Persist.blocked, ok: Persist.ok, pf: Store.build.warrant.pf }))).toEqual({ blocked: false, ok: true, pf: 40 });
  await page.evaluate(() => { Store.dispatch({ type: 'setNotes', notes: 'Saved after reusing the original' }); App.flushSave(); });
  await page.reload();
  expect(await page.evaluate(() => Store.build.notes)).toBe('Saved after reusing the original');
  expect(await page.evaluate(prefix => Object.keys(localStorage).filter(key => key.startsWith(prefix)), RECOVERY)).toEqual([archiveKey]);
  expect(await page.evaluate(key => localStorage.getItem(key), archiveKey)).toBe(raw);
});

for (const change of ['invalid', 'removed']) {
  test(`a ${change} value still archives the exact original before replacing primary storage`, async ({ page }) => {
    const raw = await storedFixture(page, change);
    await page.addInitScript(({ key, prefix }) => {
      const original = Storage.prototype.setItem;
      window.recoveryWrites = [];
      Storage.prototype.setItem = function (name, value) {
        if (name === key || String(name).startsWith(prefix)) window.recoveryWrites.push({ name, value });
        return original.call(this, name, value);
      };
    }, { key: KEY, prefix: RECOVERY });
    await page.reload();
    const writes = await page.evaluate(() => window.recoveryWrites);
    expect(writes[0].name).toMatch(/^voidship-builder:recovery:/);
    expect(writes[0].value).toBe(raw);
    expect(writes[1].name).toBe(KEY);
    expect(writes[1].value).not.toBe(raw);
    await expect(page.locator('#recoveryNotice')).toBeVisible();
  });
}

test('unrelated old archives cannot replace the required original when archival fails', async ({ page }) => {
  const raw = await storedFixture(page, 'invalid');
  await page.evaluate(prefix => localStorage.setItem(prefix + '1000-other', 'an unrelated earlier original'), RECOVERY);
  await page.addInitScript(prefix => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (String(key).startsWith(prefix)) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  }, RECOVERY);
  await page.reload();
  await page.evaluate(() => { Store.dispatch({ type: 'setNotes', notes: 'Still only in memory' }); App.flushSave(); });
  expect(await page.evaluate(() => Persist.blocked)).toBe(true);
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(raw);
  const download = page.waitForEvent('download');
  await page.locator('#recoveryDownload').click();
  expect(await readFile(await (await download).path(), 'utf8')).toBe(raw);
});

test('retained copies can be downloaded individually and deleted only after explicit confirmation', async ({ page }) => {
  const copies = [RECOVERY + '1000-first', RECOVERY + '2000-second'];
  await page.evaluate(copies => copies.forEach((key, index) => localStorage.setItem(key, `original ${index + 1}`)), copies);
  await page.reload();
  await page.locator('#recoveryCopies summary').click();
  const download = page.waitForEvent('download');
  await page.locator(`[data-recovery-download="${copies[0]}"]`).click();
  expect(await readFile(await (await download).path(), 'utf8')).toBe('original 1');
  await page.locator(`[data-recovery-delete="${copies[0]}"]`).click();
  expect(await page.evaluate(key => localStorage.getItem(key), copies[0])).toBe('original 1');
  await page.locator('[data-recovery-keep]').click();
  expect(await page.evaluate(key => localStorage.getItem(key), copies[0])).toBe('original 1');
  await page.locator(`[data-recovery-delete="${copies[0]}"]`).click();
  await page.locator(`[data-recovery-delete="${copies[0]}"]`).click();
  expect(await page.evaluate(copies => copies.map(key => localStorage.getItem(key)), copies)).toEqual([null, 'original 2']);
});

test('the required original cannot be deleted while primary saves fail', async ({ page }) => {
  const raw = await storedFixture(page, 'invalid');
  const archiveKey = RECOVERY + '1000-protected';
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: archiveKey, raw });
  await page.addInitScript(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key && !window.allowPrimarySave) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return original.call(this, name, value);
    };
  }, KEY);
  await page.reload();
  await page.locator('#recoveryCopies summary').click();
  await expect(page.locator(`[data-recovery-delete="${archiveKey}"]`)).toBeDisabled();
  expect(await page.evaluate(key => Persist.removeRecovery(key), archiveKey)).toBe(false);
  expect(await page.evaluate(key => localStorage.getItem(key), archiveKey)).toBe(raw);
  await page.evaluate(() => { window.allowPrimarySave = true; });
  await page.locator('#recoveryRetry').click();
  expect(await page.evaluate(() => Persist.ok)).toBe(true);
  await expect(page.locator(`[data-recovery-delete="${archiveKey}"]`)).toBeEnabled();
});

test('deleting an older copy can free quota and save current edits only after archiving the required original', async ({ page }) => {
  const raw = await storedFixture(page, 'invalid');
  const oldKey = RECOVERY + '1000-older';
  await page.evaluate(key => localStorage.setItem(key, 'older original selected for deletion'), oldKey);
  await page.addInitScript(({ prefix, oldKey }) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (String(key).startsWith(prefix) && localStorage.getItem(oldKey) !== null) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  }, { prefix: RECOVERY, oldKey });
  await page.reload();
  expect(await page.evaluate(() => Persist.blocked)).toBe(true);
  await page.evaluate(() => { Store.dispatch({ type: 'setNotes', notes: 'Keep edits made while storage was blocked' }); });
  await page.locator('#recoveryCopies summary').click();
  await page.locator(`[data-recovery-delete="${oldKey}"]`).click();
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe(raw);
  await page.locator(`[data-recovery-delete="${oldKey}"]`).click();
  const result = await page.evaluate(({ key, prefix, oldKey }) => ({
    blocked: Persist.blocked,
    ok: Persist.ok,
    older: localStorage.getItem(oldKey),
    originals: Object.keys(localStorage).filter(key => key.startsWith(prefix)).map(key => localStorage.getItem(key)),
    notes: JSON.parse(localStorage.getItem(key)).builds[Store.buildId].build.notes,
  }), { key: KEY, prefix: RECOVERY, oldKey });
  expect(result).toEqual({ blocked: false, ok: true, older: null, originals: [raw], notes: 'Keep edits made while storage was blocked' });
});
