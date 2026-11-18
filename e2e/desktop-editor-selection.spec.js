import { test, expect } from '@playwright/test';
import { seedSongWithChord } from './fixtures/seed.js';

// Lines that aren't being edited are plain text, so a drag from one line into
// another is a real browser selection that can be copied, cut, deleted, typed
// over and pasted over (editor_multiline_selection, version A).
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const LINES = ['Primera linea de prueba', 'Segunda linea de prueba', 'Tercera linea de prueba'];

async function openEditor(page, title) {
  await page.goto('/');
  await page.getByPlaceholder('Buscar').first().fill(title);
  await page.getByText(title).first().click();
  await page.locator('.thread-card').first().click();
  await expect(page.locator('.ne-line-view').first()).toBeVisible();
}

// Press inside line `from` (x offset px into its box) and drag into line `to`.
async function dragSelect(page, from, to, { fromX = 1, toX = 120 } = {}) {
  const a = await page.locator(`[data-line-index="${from}"] .ne-line-view`).boundingBox();
  const b = await page.locator(`[data-line-index="${to}"] .ne-line-view`).boundingBox();
  // The lower part of the box is the text itself; a chorded line's pill sits above it
  // and dragging a pill moves the chord instead of selecting.
  await page.mouse.move(a.x + fromX, a.y + a.height - 9);
  await page.mouse.down();
  await page.mouse.move(b.x + toX, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

test('lines that are not being edited are plain text', async ({ page }) => {
  const title = `E2E sel plain ${Date.now()}`;
  const seed = await seedSongWithChord({ title, lines: LINES, chords: [] });
  try {
    await openEditor(page, title);
    await expect(page.locator('.ne-line-view')).toHaveCount(3);
    await expect(page.locator('.ne-line-view').first()).toHaveText(LINES[0]);
  } finally { await seed.cleanup(); }
});

test('a line does not move when it turns into a text field', async ({ page }) => {
  const title = `E2E sel layout ${Date.now()}`;
  const seed = await seedSongWithChord({ title, lines: LINES, chords: [{ lineIndex: 0, position: 0, name: 'Am' }] });
  try {
    await openEditor(page, title);
    const rows = page.locator('.ne-row');
    const heights = async () => (await rows.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height * 10) / 10)));
    const tops = async () => (await rows.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top * 10) / 10)));
    const before = { h: await heights(), t: await tops() };

    await page.locator('[data-line-index="1"] .ne-line-view').click();   // becomes the field
    await expect(page.locator('[data-line-index="1"] .ne-line-view')).toHaveCount(0);
    const after = { h: await heights(), t: await tops() };

    before.h.forEach((h, i) => expect(Math.abs(h - after.h[i])).toBeLessThanOrEqual(1));
    before.t.forEach((t, i) => expect(Math.abs(t - after.t[i])).toBeLessThanOrEqual(1));
  } finally { await seed.cleanup(); }
});

test('a click puts the caret where it landed, and typing goes there', async ({ page }) => {
  const title = `E2E sel caret ${Date.now()}`;
  const seed = await seedSongWithChord({ title, lines: LINES, chords: [] });
  try {
    await openEditor(page, title);
    const box = await page.locator('[data-line-index="1"] .ne-line-view').boundingBox();
    await page.mouse.click(box.x + 60, box.y + box.height / 2);
    await page.keyboard.type('ZZ');
    await expect.poll(async () => (await seed.textNow()).includes('ZZ'), { timeout: 8000 }).toBe(true);
    const text = await seed.textNow();
    const second = text.split('\n')[1];
    expect(second).toContain('ZZ');
    expect(second.endsWith('ZZ')).toBe(false);   // in the middle, where the click was
    expect(second.startsWith('ZZ')).toBe(false);
  } finally { await seed.cleanup(); }
});

test('dragging across lines selects them, shows the bar, and Copy puts the lyrics on the clipboard', async ({ page }) => {
  const title = `E2E sel copy ${Date.now()}`;
  const seed = await seedSongWithChord({ title, lines: LINES, chords: [{ lineIndex: 0, position: 0, name: 'Am' }] });
  try {
    await openEditor(page, title);
    // Chords load a moment after the text and make their line taller: measure after.
    await expect(page.locator('.lc-pill').first()).toBeVisible();
    await dragSelect(page, 0, 2);
    await expect(page.locator('.range-bar')).toBeVisible();
    await page.getByRole('button', { name: 'Copiar' }).click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    // Lyrics only: no syllable counts, rhyme letters or chord names.
    const got = clip.split('\n');
    expect(got).toHaveLength(3);
    expect(LINES[0].endsWith(got[0]) && got[0].length > 0).toBe(true);   // the tail of the first line
    expect(got[1]).toBe(LINES[1]);                                      // a whole middle line
    expect(LINES[2].startsWith(got[2]) && got[2].length > 0).toBe(true);  // the head of the last
    expect(clip).not.toMatch(/Am/);
    // and the song itself is untouched
    expect(await seed.textNow()).toBe(LINES.join('\n'));
  } finally { await seed.cleanup(); }
});

test('Ctrl+C copies a cross-line selection too', async ({ page }) => {
  const title = `E2E sel ctrlc ${Date.now()}`;
  const seed = await seedSongWithChord({ title, lines: LINES, chords: [] });
  try {
    await openEditor(page, title);
    await dragSelect(page, 0, 1);
    await page.keyboard.press('Control+C');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    const got = clip.split('\n');
    expect(got).toHaveLength(2);
    expect(LINES[0].endsWith(got[0])).toBe(true);
    expect(LINES[1].startsWith(got[1])).toBe(true);
  } finally { await seed.cleanup(); }
});

test('Backspace deletes a cross-line selection and joins what is left', async ({ page }) => {
  const title = `E2E sel delete ${Date.now()}`;
  const seed = await seedSongWithChord({ title, lines: LINES, chords: [] });
  try {
    await openEditor(page, title);
    // from inside line 0 (after "Primera ") to inside line 2
    await dragSelect(page, 0, 2, { fromX: 60, toX: 90 });
    await page.keyboard.press('Backspace');
    await expect.poll(async () => (await seed.textNow()).split('\n').length, { timeout: 8000 }).toBe(1);
    const text = await seed.textNow();
    expect(text.startsWith('Primera')).toBe(true);
    expect(text).toContain('de prueba');         // the tail of line 2 survives, joined on
    expect(text).not.toContain('Segunda');
  } finally { await seed.cleanup(); }
});

test('typing over a cross-line selection replaces it', async ({ page }) => {
  const title = `E2E sel type ${Date.now()}`;
  const seed = await seedSongWithChord({ title, lines: LINES, chords: [] });
  try {
    await openEditor(page, title);
    await dragSelect(page, 0, 1, { fromX: 60, toX: 90 });
    await page.keyboard.type('X');
    await expect.poll(async () => (await seed.textNow()).split('\n').length, { timeout: 8000 }).toBe(2);
    const text = await seed.textNow();
    expect(text).toContain('X');
    expect(text).not.toContain('Segunda');
  } finally { await seed.cleanup(); }
});

test('Cut removes the selection and leaves it on the clipboard', async ({ page }) => {
  const title = `E2E sel cut ${Date.now()}`;
  const seed = await seedSongWithChord({ title, lines: LINES, chords: [] });
  try {
    await openEditor(page, title);
    await dragSelect(page, 0, 1, { fromX: 1, toX: 150 });
    await page.getByRole('button', { name: 'Cortar' }).click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip.split('\n')).toHaveLength(2);
    await expect.poll(async () => (await seed.textNow()).includes('Primera'), { timeout: 8000 }).toBe(false);
  } finally { await seed.cleanup(); }
});

test('pasting several lines over a selection (as from Notes) splits them into lines', async ({ page }) => {
  const title = `E2E sel paste ${Date.now()}`;
  const seed = await seedSongWithChord({ title, lines: LINES, chords: [] });
  try {
    await openEditor(page, title);
    await dragSelect(page, 0, 0, { fromX: 1, toX: 400 });
    await page.evaluate(() => navigator.clipboard.writeText('uno\ndos\ntres'));
    await page.keyboard.press('Control+V');
    await expect.poll(async () => (await seed.textNow()).split('\n').length, { timeout: 8000 }).toBeGreaterThanOrEqual(5);
    const text = await seed.textNow();
    expect(text.split('\n').slice(0, 3)).toEqual(['uno', 'dos', expect.stringMatching(/^tres/)]);
  } finally { await seed.cleanup(); }
});

test('chords still sit over the text in plain-text view', async ({ page }) => {
  const title = `E2E sel chords ${Date.now()}`;
  const seed = await seedSongWithChord({ title, lines: LINES, chords: [{ lineIndex: 0, position: 0, name: 'Am' }] });
  try {
    await openEditor(page, title);
    const pill = await page.locator('.lc-pill[data-chord-id]').first().boundingBox();
    const text = await page.locator('[data-line-index="0"] .ne-line-view').boundingBox();
    expect(pill.y + pill.height).toBeLessThanOrEqual(text.y + text.height);  // above or on the line
    expect(pill.y).toBeGreaterThanOrEqual(text.y - 40);
    expect(pill.x).toBeGreaterThanOrEqual(text.x - 4);
  } finally { await seed.cleanup(); }
});

test('double-clicking a word still selects it for Rima / Alternativa', async ({ page }) => {
  const title = `E2E sel word ${Date.now()}`;
  const seed = await seedSongWithChord({ title, lines: LINES, chords: [] });
  try {
    await openEditor(page, title);
    const box = await page.locator('[data-line-index="1"] .ne-line-view').boundingBox();
    await page.mouse.dblclick(box.x + 30, box.y + box.height / 2);   // inside "Segunda"
    // The line became a field with the word selected, so the Muse's tools are live.
    await expect(page.getByRole('button', { name: 'Rima' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Alternativa' })).toBeEnabled();
    const picked = await page.evaluate(() => {
      const t = document.activeElement;
      return t.tagName === 'TEXTAREA' ? t.value.slice(t.selectionStart, t.selectionEnd) : null;
    });
    expect(picked).toBe('Segunda');
  } finally { await seed.cleanup(); }
});
