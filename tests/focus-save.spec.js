import { test, expect } from '@playwright/test';

const STORAGE_KEY = 'voidship-builder:v1';
const instant = new Date('2026-09-07T12:00:00Z');

test.beforeEach(async ({ page }) => {
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.clock.install({ time: instant });
  await page.clock.pauseAt(instant);
  await page.goto('./');
  await page.clock.runFor(301);
});

async function save(page, trigger) {
  if (trigger === 'Ctrl+S' || trigger === 'Meta+S') {
    await page.keyboard.press(trigger === 'Ctrl+S' ? 'Control+s' : 'Meta+s');
  } else if (trigger === 'hidden tab') {
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
  } else {
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  }
}

async function savedBuild(page) {
  return page.evaluate(key => {
    const saved = JSON.parse(localStorage.getItem(key));
    return saved.builds[saved.activeId].build;
  }, STORAGE_KEY);
}

for (const trigger of ['Ctrl+S', 'Meta+S', 'hidden tab', 'pagehide']) {
  test(`${trigger} saves Notes and keeps selection, scrolling, and subsequent typing`, async ({ page }) => {
    await page.locator('[data-sec="notes"] summary').click();
    const notes = page.locator('#notes');
    const text = 'Captain log\n' + 'A long voyage across the void.\n'.repeat(15);
    await notes.fill(text);
    const position = await notes.evaluate(el => {
      el.setSelectionRange(8, 11, 'backward');
      el.scrollTop = 100;
      return { top: el.scrollTop, x: window.scrollX, y: window.scrollY };
    });
    await save(page, trigger);
    expect((await savedBuild(page)).notes).toBe(text);
    await expect(notes).toBeFocused();
    expect(await notes.evaluate(el => ({
      start: el.selectionStart, end: el.selectionEnd, direction: el.selectionDirection,
      top: el.scrollTop, x: window.scrollX, y: window.scrollY,
    }))).toEqual({ start: 8, end: 11, direction: 'backward', ...position });
    await page.keyboard.type('g');
    await expect(notes).toHaveValue('Captain g\n' + 'A long voyage across the void.\n'.repeat(15));
    expect(await page.evaluate(() => Store.build.gmOverride)).toBe(false);
    await save(page, trigger);
    await page.reload();
    expect((await savedBuild(page)).notes).toBe('Captain g\n' + 'A long voyage across the void.\n'.repeat(15));
  });
}

test('saving names and repeated adjustment fields preserves the exact editor and commits each edit once', async ({ page }) => {
  await page.evaluate(() => {
    Store.dispatch({ type: 'setWarrantManual', pf: 50, sp: 40 });
    Store.dispatch({ type: 'addSpMod', cause: 'First', value: 1 });
    Store.dispatch({ type: 'addSpMod', cause: 'Second', value: 2 });
  });
  const cases = [
    ['#buildName', 'Voyager', b => b.name],
    ['#pfIn', '65', b => String(b.warrant.pf)],
    ['#spIn', '55', b => String(b.warrant.sp)],
    ['.sprow:nth-of-type(3) .cause', 'Second reason', b => b.spMods[1].cause],
    ['.sprow:nth-of-type(3) .val', '-15', b => String(b.spMods[1].value)],
  ];
  for (const [selector, value, read] of cases) {
    const field = page.locator(selector);
    await field.fill(value);
    await field.evaluate(el => el.setSelectionRange(1, 2));
    await save(page, 'Ctrl+S');
    await expect(field).toBeFocused();
    expect(await field.evaluate(el => [el.selectionStart, el.selectionEnd])).toEqual([1, 2]);
    expect(read(await savedBuild(page))).toBe(value);
    await save(page, 'Ctrl+S');
    expect(await page.evaluate(() => Store.undo())).toBe(true);
    expect(read(await page.evaluate(() => Store.build))).not.toBe(value);
  }
});

test('saving preserves unfinished import text without importing it', async ({ page }) => {
  await page.evaluate(() => App.importCode());
  const field = page.locator('#importIn');
  await field.fill('unfinished share code');
  await field.evaluate(el => el.setSelectionRange(4, 9));
  const count = await page.evaluate(() => Persist.mem.order.length);
  await save(page, 'Ctrl+S');
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('unfinished share code');
  expect(await field.evaluate(el => [el.selectionStart, el.selectionEnd])).toEqual([4, 9]);
  expect(await page.evaluate(() => Persist.mem.order.length)).toBe(count);
});

test('keyboard Undo works for committed text and subsequent unsaved typing', async ({ page }) => {
  await page.locator('[data-sec="notes"] summary').click();
  const notes = page.locator('#notes');
  await notes.focus();
  await page.keyboard.type('Save this note');
  await page.keyboard.press('ControlOrMeta+s');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(notes).toHaveValue('');
  await page.keyboard.press('ControlOrMeta+s');
  expect((await savedBuild(page)).notes).toBe('');
  await page.keyboard.type('A new note');
  await page.keyboard.press('ControlOrMeta+s');
  await page.keyboard.type(' plus unsaved text');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(notes).toHaveValue('A new note');
  expect((await savedBuild(page)).notes).toBe('A new note');
});

test('consecutive saved edits can be undone without leaving the editor', async ({ page }) => {
  await page.locator('[data-sec="notes"] summary').click();
  const notes = page.locator('#notes');
  for (const value of ['First saved note', 'Second saved note']) {
    await notes.fill(value);
    await page.keyboard.press('ControlOrMeta+s');
  }
  for (const value of ['First saved note', '']) {
    await page.keyboard.press('ControlOrMeta+z');
    await expect(notes).toBeFocused();
    await expect(notes).toHaveValue(value);
    expect(await page.evaluate(() => Store.build.notes)).toBe(value);
  }
});

test('Redo and native edits that return to the saved value do not undo a ship change', async ({ page }) => {
  await page.locator('[data-sec="notes"] summary').click();
  const notes = page.locator('#notes');
  await notes.fill('Saved note');
  await page.keyboard.press('ControlOrMeta+s');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(notes).toHaveValue('Saved note');
  await page.keyboard.type('X');
  await page.keyboard.press('Backspace');
  await expect(notes).toHaveValue('Saved note');
  await page.keyboard.press('ControlOrMeta+z');
  // Native Undo may group keystrokes differently, but must not consume the ship's saved edit.
  expect(await page.evaluate(() => Store.build.notes)).toBe('Saved note');
  expect(await page.evaluate(() => Store.canUndo())).toBe(true);
});
