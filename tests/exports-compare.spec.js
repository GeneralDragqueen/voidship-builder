import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.goto('./');
});

const unnumber = part => part.replace(/\n_\(part \d+\/\d+\)_$/, '');

test('F6: 1,650 characters of notes produce bounded messages and reconstructable share fragments', async ({ page }) => {
  const result = await page.evaluate(() => {
    const build = App.swordTestBuild();
    build.notes = 'n'.repeat(1650);
    const md = Export.markdown(Export.dossier(build, Derive.derive(build)));
    const parts = Export.chunks(md);
    const fragments = parts.map(part => part.match(/Share code fragment (\d+)\/(\d+) \(join in order\):\n`([^`]+)`/)).filter(Boolean);
    const code = fragments.map(match => match[3]).join('');
    return { md, parts, code, expectedCode: Share.encode(build), decodedNotes: code ? Share.decode(code).build.notes : null,
      fragmentNumbers: fragments.map(match => [Number(match[1]), Number(match[2])]) };
  });
  expect(result.parts.every(part => part.length <= 1900)).toBe(true);
  expect(result.md).toContain('n'.repeat(1650));
  expect(result.fragmentNumbers.length).toBeGreaterThan(1);
  expect(result.fragmentNumbers).toEqual(result.fragmentNumbers.map((_, index, all) => [index + 1, all.length]));
  expect(result.code).toBe(result.expectedCode);
  expect(result.decodedNotes).toBe('n'.repeat(1650));
  result.parts.forEach((part, index) => expect(part).toMatch(new RegExp(`_\\(part ${index + 1}/${result.parts.length}\\)_$`)));
});

test('F6: long lines and Unicode tokens remain lossless across more than ten final parts', async ({ page }) => {
  const source = `# Long notes\n\n${'🚀🛰️α'.repeat(6500)}\n${'unbroken'.repeat(900)}\n\nEnd.`;
  const parts = await page.evaluate(source => Export.chunks(source), source);
  expect(parts.length).toBeGreaterThan(10);
  expect(parts.every(part => part.length <= 1900)).toBe(true);
  expect(parts.map(unnumber).join('')).toBe(source);
  for (const part of parts) {
    expect(part).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
  }
});

test('F6: code fences are closed and reopened with their language inside the final budget', async ({ page }) => {
  const source = `Before\n\n\`\`\`javascript\n${'console.log("🚀");'.repeat(420)}\n\`\`\`\n\nBetween\n\n~~~text\n${'long-code-token'.repeat(500)}\n~~~\n\nAfter`;
  const parts = await page.evaluate(source => Export.chunks(source), source);
  expect(parts.length).toBeGreaterThan(3);
  expect(parts.every(part => part.length <= 1900)).toBe(true);
  const unfence = text => text.replace(/^ {0,3}(?:`{3,}|~{3,})[^\n]*$/gm, '').replace(/\s+/g, '');
  expect(parts.map(unnumber).map(unfence).join('')).toBe(unfence(source));
  for (const part of parts) {
    expect((part.match(/^```/gm) || []).length % 2).toBe(0);
    expect((part.match(/^~~~/gm) || []).length % 2).toBe(0);
    if (part.startsWith('```')) expect(part).toMatch(/^```javascript\n/);
    if (part.startsWith('~~~')) expect(part).toMatch(/^~~~text\n/);
  }
});

test('F6: numbering and share guidance are budgeted after counts gain digits', async ({ page }) => {
  const result = await page.evaluate(() => {
    const build = Actions.newBuild('Large shared vessel');
    build.notes = '🚀'.repeat(2500);
    const md = Export.markdown(Export.dossier(build, Derive.derive(build)));
    const parts = Export.chunks(md, 120);
    const fragments = parts.map(part => part.match(/Share code fragment (\d+)\/(\d+) \(join in order\):\n`([^`]+)`/)).filter(Boolean);
    return { parts, code: fragments.map(match => match[3]).join(''), expectedCode: Share.encode(build), fragments: fragments.length };
  });
  expect(result.parts.length).toBeGreaterThan(100);
  expect(result.fragments).toBeGreaterThan(100);
  expect(result.parts.every(part => part.length <= 120)).toBe(true);
  expect(result.code).toBe(result.expectedCode);
  result.parts.forEach((part, index) => expect(part.endsWith(`_(part ${index + 1}/${result.parts.length})_`)).toBe(true));
});

test('F6: exact boundary and short exports stay unchanged; custom limits preserve long text', async ({ page }) => {
  const result = await page.evaluate(() => ({
    short: Export.chunks('Short Markdown'),
    exact: Export.chunks('x'.repeat(1900)),
    over: Export.chunks('x'.repeat(1901)),
    custom: Export.chunks('🚀'.repeat(400), 120),
  }));
  expect(result.short).toEqual(['Short Markdown']);
  expect(result.exact).toEqual(['x'.repeat(1900)]);
  expect(result.over.every(part => part.length <= 1900)).toBe(true);
  expect(result.over.map(unnumber).join('')).toBe('x'.repeat(1901));
  expect(result.custom.every(part => part.length <= 120)).toBe(true);
  expect(result.custom.map(unnumber).join('')).toBe('🚀'.repeat(400));
});

for (const [label, source] of [
  ['oversized language header', `\`\`\`${'x'.repeat(2200)}\nvalue\n\`\`\``],
  ['oversized fence marker', `${'```'.repeat(700)}\n${'~~~\nvalue\n'.repeat(30)}`],
]) {
  test(`F6: ${label} falls back to bounded literal fragments without losing text`, async ({ page }) => {
    const result = await page.evaluate(source => {
      const build = App.swordTestBuild();
      build.notes = source;
      const exported = Export.chunks(Export.markdown(Export.dossier(build, Derive.derive(build))));
      const code = exported.map(part => part.match(/Share code fragment \d+\/\d+ \(join in order\):\n`([^`]+)`/)).filter(Boolean).map(match => match[1]).join('');
      return { parts: Export.chunks(source), exported, code, expectedCode: Share.encode(build) };
    }, source);
    expect(result.parts.every(part => part.length <= 1900)).toBe(true);
    expect(result.exported.every(part => part.length <= 1900)).toBe(true);
    const fragments = result.parts.map(unnumber).map(part => part.match(/^Markdown text fragment \(join in order\):\n(```|~~~)\n([\s\S]*)\n\1$/));
    expect(fragments.every(Boolean)).toBe(true);
    expect(fragments.map(fragment => fragment[2]).join('')).toBe(source);
    expect(result.code).toBe(result.expectedCode);
  });
}

for (const { counts, expected } of [
  { counts: [1, 2], expected: ['—', 'Compartmentalised Cargo Hold'] },
  { counts: [1, 3], expected: ['—', 'Compartmentalised Cargo Hold ×2'] },
  { counts: [1, 2, 3], expected: ['—', 'Compartmentalised Cargo Hold', 'Compartmentalised Cargo Hold ×2'] },
  { counts: [2, 2, 2], expected: ['—', '—', '—'] },
  { counts: [0, 2], expected: ['—', 'Compartmentalised Cargo Hold ×2'] },
]) {
  test(`F7: component quantities ${counts.join('/')} render their excess over shared copies`, async ({ page }) => {
    const valid = await page.evaluate(counts => {
      const builds = counts.map((count, index) => {
        let build = Actions.reduce(Actions.newBuild(`Cargo ship ${index + 1}`), { type: 'setHull', id: 'lunar' });
        build = Actions.reduce(build, { type: 'fixEssentials' });
        build = Actions.reduce(build, { type: 'setWarrantManual', pf: 40, sp: 100 });
        for (let i = 0; i < count; i++) build = Actions.reduce(build, { type: 'addSupp', id: 'compartmentalised_cargo' });
        return build;
      });
      Store.ui.compare = builds.map(build => Persist.create(build));
      Compare.render();
      return builds.every(build => Derive.derive(build).valid);
    }, counts);
    expect(valid).toBe(true);
    const row = page.locator('tr').filter({ has: page.getByText('Components not shared', { exact: true }) });
    await expect(row.locator('td')).toHaveText(['Components not shared', ...expected]);
  });
}

test('F7: distinct component IDs remain distinct even if display names coincide', async ({ page }) => {
  await page.evaluate(() => {
    const name = DATA.COMP.cargo_lighter.name;
    DATA.COMP.cargo_lighter.name = DATA.COMP.compartmentalised_cargo.name;
    try {
      const builds = ['compartmentalised_cargo', 'cargo_lighter'].map(id => Actions.reduce(Actions.newBuild(), { type: 'addSupp', id }));
      Store.ui.compare = builds.map(build => Persist.create(build));
      Compare.render();
    } finally {
      DATA.COMP.cargo_lighter.name = name;
    }
  });
  const row = page.locator('tr').filter({ has: page.getByText('Components not shared', { exact: true }) });
  await expect(row.locator('td')).toHaveText(['Components not shared', 'Compartmentalised Cargo Hold', 'Compartmentalised Cargo Hold']);
});

test('F7: empty essential slots and built-in holds are omitted from installed component counts', async ({ page }) => {
  await page.evaluate(() => {
    const builds = [0, 1].map(count => {
      let build = Actions.reduce(Actions.newBuild(), { type: 'setHull', id: 'jericho' });
      build = Actions.reduce(build, { type: 'fixEssentials' });
      build.essentials.plasma_drive = null;
      for (let i = 0; i < count; i++) build = Actions.reduce(build, { type: 'addSupp', id: 'main_cargo_hold' });
      return build;
    });
    Store.ui.compare = builds.map(build => Persist.create(build));
    Compare.render();
  });
  const row = page.locator('tr').filter({ has: page.getByText('Components not shared', { exact: true }) });
  await expect(row.locator('td')).toHaveText(['Components not shared', '—', 'Main Cargo Hold']);
});
