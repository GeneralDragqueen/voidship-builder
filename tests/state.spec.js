import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const STORAGE_KEY = 'voidship-builder:v1';
const instant = new Date('2026-09-07T12:00:00Z');

test.beforeEach(async ({ page }) => {
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.clock.install({ time: instant });
  await page.clock.pauseAt(instant);
  await page.goto('./');
  await page.clock.runFor(301);
});

async function savedPair(page) {
  await page.evaluate(() => { App.newBuild(); Store.dispatch({ type: 'rename', name: 'Ship A' }); });
  await page.clock.runFor(301);
  const a = await page.evaluate(() => Persist.mem.activeId);
  await page.evaluate(() => { App.newBuild(); Store.dispatch({ type: 'rename', name: 'Ship B' }); });
  await page.clock.runFor(301);
  const b = await page.evaluate(() => Persist.mem.activeId);
  return { a, b };
}

async function rawShare(page, patch) {
  return page.evaluate(patch => {
    const code = Share.encode(App.swordTestBuild());
    const raw = JSON.parse(atob(code.replace(/-/g, '+').replace(/_/g, '/')));
    Object.assign(raw, patch);
    return btoa(JSON.stringify(raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }, patch);
}

async function restoreThroughUI(page, text) {
  await page.evaluate(text => {
    Store.ui.restoreOpen = true;
    Render.aside();
    document.querySelector('#bkIn').value = text;
    document.querySelector('#bkGo').click();
  }, text);
}

test('built-in assertions all pass', async ({ page }) => {
  const results = await page.evaluate(() => SelfTest.run());
  expect(results.length).toBeGreaterThanOrEqual(57);
  expect(results.filter(line => line.startsWith('FAIL'))).toEqual([]);
});

test('F1: opening A clears B undo history and preserves both saved ships', async ({ page }) => {
  const ids = await savedPair(page);
  await page.evaluate(() => Store.dispatch({ type: 'setNotes', notes: 'B changed' }));
  await page.clock.runFor(301);
  await page.evaluate(a => App.loadBuild(a), ids.a);
  const undone = await page.evaluate(() => Store.undo());
  await page.clock.runFor(301);
  expect(undone).toBe(false);
  expect(await page.evaluate(() => Store.build.name)).toBe('Ship A');
  await page.reload();
  expect(await page.evaluate(({ a, b }) => [Persist.mem.builds[a].build.name, Persist.mem.builds[b].build.notes], ids)).toEqual(['Ship A', 'B changed']);
});

test('F2: comparison imports keep Sword and Lunar separate through autosave and reload', async ({ page }) => {
  const source = await page.evaluate(() => {
    const sword = App.swordTestBuild();
    let lunar = Actions.reduce(sword, { type: 'setHull', id: 'lunar' });
    lunar = Actions.reduce(lunar, { type: 'fixEssentials' });
    lunar.name = 'Lunar source';
    const originals = [Persist.create(sword), Persist.create(lunar)];
    App.loadBuild(originals[0]);
    return { originals, codes: [Share.encode(sword), Share.encode(lunar)] };
  });
  await page.goto('./#c=' + source.codes.join(','));
  await page.reload();
  const imported = await page.evaluate(() => [...Store.ui.compare]);
  await page.clock.runFor(301);
  expect(await page.evaluate(ids => ids.map(id => Persist.mem.builds[id].build.hull), imported)).toEqual(['sword', 'lunar']);
  await page.evaluate(() => Store.dispatch({ type: 'setNotes', notes: 'Only first imported ship changes' }));
  await page.clock.runFor(301);
  await page.evaluate(() => history.replaceState(null, '', location.pathname));
  await page.reload();
  const result = await page.evaluate(({ imported, originals }) => ({
    imported: imported.map(id => ({ hull: Persist.mem.builds[id].build.hull, notes: Persist.mem.builds[id].build.notes })),
    originals: originals.map(id => Share.encode(Persist.mem.builds[id].build)),
    active: Persist.mem.activeId,
    editorHull: Store.build.hull,
  }), { imported, originals: source.originals });
  expect(result.imported).toEqual([{ hull: 'sword', notes: 'Only first imported ship changes' }, { hull: 'lunar', notes: '' }]);
  expect(result.originals).toEqual(source.codes);
  expect(result.active).toBe(imported[0]);
  expect(result.editorHull).toBe('sword');
});

test('F3: missing-drive import remains editable and survives repair and reload', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const code = await page.evaluate(() => {
    const b = App.swordTestBuild();
    delete b.essentials.plasma_drive;
    return Share.encode(b);
  });
  await page.evaluate(code => App.importFrom(code), code);
  expect(await page.evaluate(() => Store.build.essentials.plasma_drive)).toBeNull();
  expect(await page.evaluate(() => Store.derived.issues.some(issue => issue.code === 'missing_essential'))).toBe(true);
  await expect(page.locator('#toast')).toContainText(/warning/i);
  await page.clock.runFor(301);
  await page.reload();
  expect(await page.evaluate(() => Store.build.essentials.plasma_drive)).toBeNull();
  await page.evaluate(() => Store.dispatch({ type: 'fixEssentials' }));
  await page.clock.runFor(301);
  await page.reload();
  expect(await page.evaluate(() => Store.build.essentials.plasma_drive)).toBe('jovian_2');
  expect(errors).toEqual([]);
});

test('F3: malformed shares are rejected before any storage write', async ({ page }) => {
  const before = await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY);
  for (const patch of [{ v: 2 }, { h: 'missing-hull' }, { e: [] }, { s: {} }, { s: [null] }, { w: {} }, { sm: {} }]) {
    const code = await rawShare(page, patch);
    await page.evaluate(code => App.importFrom(code), code);
    expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY), JSON.stringify(patch)).toBe(before);
    await expect(page.locator('#toast')).toContainText('could not be read');
  }
});

test('F3: comparison stages all inputs before saving and needs two usable ships', async ({ page }) => {
  const before = await page.evaluate(() => Persist.mem.order.length);
  const code = await page.evaluate(() => Share.encode(App.swordTestBuild()));
  await page.goto('./#c=' + code + ',unreadable');
  await page.reload();
  await page.clock.runFor(301);
  expect(await page.evaluate(() => Persist.mem.order.length)).toBe(before);
  expect(await page.evaluate(() => Store.ui.compare)).toBeNull();
});

for (const active of ['incomplete', 'broken']) {
  test(`F3: stored ${active} active entry recovers without hiding healthy siblings`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const raw = await page.evaluate(({ key, active }) => {
      const healthy = App.swordTestBuild();
      const incomplete = Actions.clone(healthy);
      delete incomplete.essentials.plasma_drive;
      const broken = Actions.clone(healthy);
      broken.hull = 'not-a-hull';
      const builds = { healthy, incomplete, broken };
      const raw = JSON.stringify({ version: 1, activeId: active, order: ['healthy', 'incomplete', 'broken'], prefs: { theme: 'auto' },
        builds: Object.fromEntries(Object.entries(builds).map(([id, build]) => [id, { id, name: id, createdAt: 1, updatedAt: 1, build }])) });
      localStorage.setItem(key, raw);
      return raw;
    }, { key: STORAGE_KEY, active });
    await page.reload();
    const recovered = await page.evaluate(() => ({
      active: Persist.mem.activeId,
      healthy: !!Persist.mem.builds.healthy,
      hasDrive: Store.build.essentials.plasma_drive,
      archives: Object.keys(localStorage).filter(key => key.startsWith('voidship-builder:recovery:')).map(key => localStorage.getItem(key)),
    }));
    expect(recovered.healthy).toBe(true);
    expect(recovered.active).toBe(active === 'broken' ? 'healthy' : 'incomplete');
    expect(recovered.hasDrive).toBe(active === 'broken' ? 'jovian_2' : null);
    expect(recovered.archives).toContain(raw);
    await expect(page.locator('#recoveryNotice')).toBeVisible();
    await expect(page.locator('#recoveryDownload')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('F3: numeric normalization archives original data before replacing invalid values', async ({ page }) => {
  const raw = await page.evaluate(key => {
    const saved = JSON.parse(localStorage.getItem(key));
    const build = saved.builds[saved.activeId].build;
    build.warrant.pf = 'bad-pf';
    build.warrant.sp = null;
    build.spMods = [{ id: 'invalid-adjustment', cause: 'Keep this explanation', value: 'not a number' }];
    const raw = JSON.stringify(saved);
    localStorage.setItem(key, raw);
    return raw;
  }, STORAGE_KEY);
  await page.reload();
  const result = await page.evaluate(key => ({
    values: [Store.build.warrant.pf, Store.build.warrant.sp, Store.build.spMods[0].value],
    explanation: Store.build.spMods[0].cause,
    current: localStorage.getItem(key),
    archives: Object.keys(localStorage).filter(key => key.startsWith('voidship-builder:recovery:')).map(key => localStorage.getItem(key)),
  }), STORAGE_KEY);
  expect(result.values).toEqual([40, 50, 0]);
  expect(result.explanation).toBe('Keep this explanation');
  expect(result.current).not.toBe(raw);
  expect(result.archives).toEqual([raw]);
  await expect(page.locator('#recoveryNotice')).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.evaluate(() => document.querySelector('#recoveryDownload').click());
  const download = await downloaded;
  expect(await readFile(await download.path(), 'utf8')).toBe(raw);
  await page.reload();
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('voidship-builder:recovery:')).length)).toBe(1);
  await expect(page.locator('#recoveryDownload')).toBeVisible();
});

test('F3: valid saved builds do not trigger recovery when object key order changes', async ({ page }) => {
  await page.evaluate(key => {
    const reverseKeys = value => Array.isArray(value) ? value.map(reverseKeys)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).reverse().map(([key, value]) => [key, reverseKeys(value)]))
        : value;
    const saved = JSON.parse(localStorage.getItem(key));
    saved.builds[saved.activeId].build = reverseKeys(saved.builds[saved.activeId].build);
    localStorage.setItem(key, JSON.stringify(saved));
  }, STORAGE_KEY);
  for (let reload = 0; reload < 2; reload++) {
    await page.reload();
    expect(await page.evaluate(() => Store.build.name)).toBe('Havoc of Sebastian');
    expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('voidship-builder:recovery:')))).toEqual([]);
    await expect(page.locator('#recoveryNotice')).toHaveCount(0);
  }
});

test('F3: failed recovery archival retains original storage while healthy ship stays usable', async ({ page }) => {
  const raw = await page.evaluate(key => {
    const healthy = App.swordTestBuild();
    const raw = JSON.stringify({ version: 1, activeId: 'broken', order: ['broken', 'healthy'], prefs: {}, builds: {
      broken: { id: 'broken', build: { ...healthy, hull: 'not-a-hull' } },
      healthy: { id: 'healthy', build: healthy },
    } });
    localStorage.setItem(key, raw);
    return raw;
  }, STORAGE_KEY);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (String(key).startsWith('voidship-builder:recovery:')) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.reload();
  expect(await page.evaluate(() => Store.build.hull)).toBe('sword');
  await page.evaluate(() => Store.dispatch({ type: 'setNotes', notes: 'Can still edit in memory' }));
  await page.clock.runFor(301);
  expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe(raw);
  await expect(page.locator('#recoveryNotice')).toBeVisible();
  expect(await page.evaluate(() => Store.build.notes)).toBe('Can still edit in memory');
});

for (const transition of ['open', 'new', 'duplicate', 'import', 'restore', 'delete-other', 'backup-code', 'backup-json', 'manual-save', 'page-exit']) {
  test(`F4: ${transition} preserves outgoing edits before 300 ms`, async ({ page }) => {
    const ids = await savedPair(page);
    await page.evaluate(a => App.loadBuild(a), ids.a);
    await page.clock.runFor(301);
    const result = await page.evaluate(({ a, b, transition }) => {
      Store.dispatch({ type: 'setNotes', notes: 'Unsaved outgoing edits' });
      let backup = null;
      if (transition === 'open') App.loadBuild(b);
      if (transition === 'new') App.newBuild();
      if (transition === 'duplicate') App.duplicate(a);
      if (transition === 'import') App.importFrom(Share.encode(Actions.newBuild('Incoming import')));
      if (transition === 'restore') {
        Store.ui.restoreOpen = true;
        Render.aside();
        document.querySelector('#bkIn').value = JSON.stringify({ v: 1, app: 'voidship-builder', builds: [{ code: Share.encode(Actions.newBuild('Restored ship')) }] });
        document.querySelector('#bkGo').click();
      }
      if (transition === 'delete-other') { App.remove(b); App.remove(b); }
      if (transition === 'backup-code') backup = Backup.parse(Backup.encode());
      if (transition === 'backup-json') backup = Backup.parse(Backup.json());
      if (transition === 'manual-save') document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
      if (transition === 'page-exit') window.dispatchEvent(new Event('pagehide'));
      return { backupNotes: backup?.builds.map(entry => Share.decode(entry.code).build).find(build => build.name === 'Ship A')?.notes,
        duplicateNotes: transition === 'duplicate' ? Store.build.notes : null };
    }, { ...ids, transition });
    if (transition.startsWith('backup-')) expect(result.backupNotes).toBe('Unsaved outgoing edits');
    if (transition === 'duplicate') expect(result.duplicateNotes).toBe('Unsaved outgoing edits');
    // Reload before the timer can fire: successful recovery must come from the transition itself.
    await page.reload();
    expect(await page.evaluate(a => Persist.mem.builds[a].build.notes, ids.a)).toBe('Unsaved outgoing edits');
  });
}

test('F4: outgoing pending snapshot cannot overwrite the next build after its timer fires', async ({ page }) => {
  const ids = await savedPair(page);
  await page.evaluate(({ a, b }) => {
    App.loadBuild(a);
    Store.dispatch({ type: 'setNotes', notes: 'A newest' });
    App.loadBuild(b);
    Store.dispatch({ type: 'setNotes', notes: 'B newest' });
  }, ids);
  await page.clock.runFor(301);
  expect(await page.evaluate(({ a, b }) => [Persist.mem.builds[a].build.notes, Persist.mem.builds[b].build.notes], ids)).toEqual(['A newest', 'B newest']);
});

test('F4: restore activates the last added ship and an all-skipped restore keeps the current ship', async ({ page }) => {
  const text = await page.evaluate(() => JSON.stringify({ v: 1, app: 'voidship-builder', builds: [
    { code: Share.encode(Actions.newBuild('Restored first')) },
    { code: 'unreadable' },
    { code: Share.encode(Actions.newBuild('Restored last')) },
  ] }));
  await restoreThroughUI(page, text);
  expect(await page.evaluate(() => Store.build.name)).toBe('Restored last');
  const active = await page.evaluate(() => Persist.mem.activeId);
  await restoreThroughUI(page, text);
  expect(await page.evaluate(() => Persist.mem.activeId)).toBe(active);
  expect(await page.evaluate(() => Store.build.name)).toBe('Restored last');
});

for (const [pf, sp] of [[0, 0], [0, 50], [40, 0]]) {
  test(`F5: manual PF ${pf}/SP ${sp} survives share and both backup forms`, async ({ page }) => {
    const roundtrips = await page.evaluate(({ pf, sp }) => {
      Store.dispatch({ type: 'setWarrantManual', pf, sp });
      // Save explicitly here so this case isolates numeric decoding from F4.
      Persist.update(Persist.mem.activeId, Store.build);
      const name = Store.build.name;
      const value = build => [build.warrant.pf, build.warrant.sp, build.warrant.manual];
      return { share: value(Share.decode(Share.encode(Store.build)).build),
        backups: [Backup.encode(), Backup.json()].map(text => value(Share.decode(Backup.parse(text).builds.find(entry => entry.name === name).code).build)) };
    }, { pf, sp });
    expect(roundtrips.share).toEqual([pf, sp, true]);
    expect(roundtrips.backups).toEqual([[pf, sp, true], [pf, sp, true]]);
    for (const format of ['code', 'json']) {
      const text = await page.evaluate(format => format === 'code' ? Backup.encode() : Backup.json(), format);
      await page.evaluate(key => localStorage.removeItem(key), STORAGE_KEY);
      await page.reload();
      await restoreThroughUI(page, text);
      expect(await page.evaluate(() => [Store.build.warrant.pf, Store.build.warrant.sp, Store.build.warrant.manual])).toEqual([pf, sp, true]);
    }
  });
}

test('F5: invalid warrant numbers default while valid numeric strings retain zero', async ({ page }) => {
  for (const [w, wanted] of [
    [[5, '0', '0', 1], [0, 0]],
    [[5, null, null, 1], [40, 50]],
    [[5, '', '  ', 1], [40, 50]],
    [[5, 'not a number', 'Infinity', 1], [40, 50]],
    [[5, false, {}, 1], [40, 50]],
  ]) {
    const code = await rawShare(page, { w });
    expect(await page.evaluate(code => {
      const b = Share.decode(code).build;
      return [b.warrant.pf, b.warrant.sp];
    }, code)).toEqual(wanted);
  }
});
