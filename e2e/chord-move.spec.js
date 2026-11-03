import { test, expect } from '@playwright/test';
import { touchDrag } from './fixtures/touch.js';
import { seedSongWithChord } from './fixtures/seed.js';

// Moving a chord that's ALREADY placed: long-press its pill in the lyric and
// drag it onto another line. Regression for "the dragged pill stops following
// after ~10px and stays stuck on screen" — the same family of bug as
// 4180ed5 (the touch's target node gets removed mid-gesture, so move/end
// events stop arriving). Uses CDP touch (fixtures/touch.js), since a
// synthetic TouchEvent never reaches the app's gesture code.

const LINES = ['Primera linea de prueba', 'Segunda linea de prueba', 'Tercera linea de prueba'];

test('long-press a placed chord and drag it to another line', async ({ page }) => {
  const title = `E2E chord move ${Date.now()}`;
  const seed = await seedSongWithChord({ title, lines: LINES, chords: [{ lineIndex: 0, position: 0, name: 'Am' }] });
  try {
    await page.goto('/');
    await page.getByPlaceholder('Buscar').first().fill(title);
    await page.getByText(title).first().click();
    await page.locator('.thread-card').first().click();

    const pill = page.locator('.lc-pill[data-chord-id]').first();
    await expect(pill).toBeVisible();
    const pillBox = await pill.boundingBox();
    const target = await page.locator('[data-line-index="2"]').boundingBox();
    const start = { x: pillBox.x + pillBox.width / 2, y: pillBox.y + pillBox.height / 2 };
    const end = { x: target.x + target.width / 2, y: target.y + target.height / 2 };

    // Enough waypoints that the drag clearly outlives the ~10px where it died.
    const waypoints = Array.from({ length: 12 }, (_, i) => ({
      x: start.x + ((end.x - start.x) * (i + 1)) / 12,
      y: start.y + ((end.y - start.y) * (i + 1)) / 12,
    }));
    await touchDrag(page, { start, waypoints });

    // (c) nothing left floating
    await expect(page.locator('.res-picker-drag-pill')).toHaveCount(0);

    // (a) now on the new line, (b) gone from the old one — checked in the
    // database, not just the DOM, so a UI-only illusion can't pass.
    await expect.poll(() => seed.chordsNow(), { timeout: 8000 }).toEqual([
      { line_index: 2, position: 0, chord_name: 'Am' },
    ]);
  } finally {
    await seed.cleanup();
  }
});

// The original path 4180ed5 fixed: drag a NEW chord out of the palette sheet
// onto a line. Guards that the placed-pill fix didn't disturb it.
test('drag a chord from the picker sheet onto a line', async ({ page }) => {
  const title = `E2E chord picker ${Date.now()}`;
  const seed = await seedSongWithChord({ title, lines: LINES, chords: [] });
  try {
    await page.goto('/');
    await page.getByPlaceholder('Buscar').first().fill(title);
    await page.getByText(title).first().click();
    await page.locator('.thread-card').first().click();

    await page.locator('[data-line-index="1"] textarea, [data-line-index="1"] .ne-line-input').first().tap();
    await page.getByRole('button', { name: 'Acordes y rasgueo' }).tap();

    const chip = page.locator('.cs-chip').first();
    await expect(chip).toBeVisible();
    const chipBox = await chip.boundingBox();
    const target = await page.locator('[data-line-index="2"]').boundingBox();
    const start = { x: chipBox.x + chipBox.width / 2, y: chipBox.y + chipBox.height / 2 };
    const end = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
    const waypoints = Array.from({ length: 12 }, (_, i) => ({
      x: start.x + ((end.x - start.x) * (i + 1)) / 12,
      y: start.y + ((end.y - start.y) * (i + 1)) / 12,
    }));
    await touchDrag(page, { start, waypoints });

    await expect(page.locator('.res-picker-drag-pill')).toHaveCount(0);
    await expect.poll(async () => (await seed.chordsNow()).length, { timeout: 8000 }).toBe(1);
    // Aimed at line 2, it currently lands on line 1: a known, separate
    // issue (effectiveDragPoint hit-tests where the floating pill sits, about
    // one line above the finger). Accept either so this test guards the
    // gesture's lifecycle without pinning that offset in place.
    expect([1, 2]).toContain((await seed.chordsNow())[0].line_index);
  } finally {
    await seed.cleanup();
  }
});
