import { test, expect } from '@playwright/test';
import { seedSongWithChord } from './fixtures/seed.js';

// Wide screens show the mobile app in a centred, wider column (docs/adr/0001),
// and a MOUSE gets its own gestures (docs/adr/0002): drag a chord by pressing
// and moving a few pixels — no long-press — hover to delete, Escape to close.

const LINES = ['Primera linea de prueba', 'Segunda linea de prueba', 'Tercera linea de prueba'];

async function openSong(page, title) {
  await page.goto('/');
  await page.getByPlaceholder('Buscar').first().fill(title);
  await page.getByText(title).first().click();
  await page.locator('.thread-card').first().click();
}

const centre = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

test('a wide window shows the mobile app in a centred, fluid column — no canvas, no frame', async ({ page }) => {
  await page.goto('/');
  const screen = page.locator('.mobile-screen').first();
  await expect(screen).toBeVisible();
  const box = await screen.boundingBox();
  // 82% of the window (never under 760px), centred.
  expect(Math.abs(box.width - 1280 * 0.82)).toBeLessThan(3);
  expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThan(2);
  await expect(page.locator('.react-flow')).toHaveCount(0);
  await expect(page.locator('.phone-frame-screen')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-input', 'mouse');
});

test('the column and the type grow with the window instead of sitting in a fixed box', async ({ page }) => {
  await page.goto('/');
  const measure = async () => ({
    width: (await page.locator('.mobile-screen').first().boundingBox()).width,
    font: await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)),
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  const small = await measure();
  await page.setViewportSize({ width: 1920, height: 1080 });
  const large = await measure();
  expect(large.width).toBeGreaterThan(small.width * 1.3);
  expect(large.font).toBeGreaterThan(small.font * 1.15);
});

test('chords re-measure when the window is resized', async ({ page }) => {
  const title = `E2E resize chords ${Date.now()}`;
  const seed = await seedSongWithChord({ title, lines: LINES, chords: [{ lineIndex: 0, position: 0, name: 'Am' }, { lineIndex: 0, position: 1, name: 'G' }] });
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openSong(page, title);
    const pill = page.locator('.lc-pill[data-chord-id]').first();
    await expect(pill).toBeVisible();
    const before = (await pill.boundingBox()).width;
    await page.setViewportSize({ width: 2200, height: 1000 });
    // A pill is as wide as its slice of the line, and the type got bigger.
    await expect.poll(async () => (await pill.boundingBox()).width, { timeout: 5000 }).toBeGreaterThan(before * 1.2);
  } finally {
    await seed.cleanup();
  }
});

test('a narrow window fills the width, like a phone', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await page.goto('/');
  const box = await page.locator('.mobile-screen').first().boundingBox();
  expect(Math.round(box.width)).toBe(700);
});

test('a mouse drags a placed chord with no long-press, and a plain click does not', async ({ page }) => {
  const title = `E2E mouse chord ${Date.now()}`;
  const seed = await seedSongWithChord({ title, lines: LINES, chords: [{ lineIndex: 0, position: 0, name: 'Am' }] });
  try {
    await openSong(page, title);
    const pill = page.locator('.lc-pill[data-chord-id]').first();
    await expect(pill).toBeVisible();

    // A click is not a drag: nothing floats, the chord stays where it was.
    await pill.click();
    await expect(page.locator('.res-picker-drag-pill')).toHaveCount(0);
    expect(await seed.chordsNow()).toEqual([{ line_index: 0, position: 0, chord_name: 'Am' }]);

    // Press, move — no waiting — release on another line.
    const start = centre(await pill.boundingBox());
    const end = centre(await page.locator('[data-line-index="2"]').boundingBox());
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(start.x + ((end.x - start.x) * i) / 10, start.y + ((end.y - start.y) * i) / 10);
    }
    await expect(page.locator('.res-picker-drag-pill')).toHaveCount(1); // being carried
    await page.mouse.up();

    await expect(page.locator('.res-picker-drag-pill')).toHaveCount(0);
    await expect.poll(() => seed.chordsNow(), { timeout: 8000 }).toEqual([
      { line_index: 2, position: 0, chord_name: 'Am' },
    ]);
  } finally {
    await seed.cleanup();
  }
});

test('Escape abandons a drag and drops nothing', async ({ page }) => {
  const title = `E2E mouse esc ${Date.now()}`;
  const seed = await seedSongWithChord({ title, lines: LINES, chords: [{ lineIndex: 0, position: 0, name: 'Am' }] });
  try {
    await openSong(page, title);
    const pill = page.locator('.lc-pill[data-chord-id]').first();
    const start = centre(await pill.boundingBox());
    const end = centre(await page.locator('[data-line-index="2"]').boundingBox());
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await expect(page.locator('.res-picker-drag-pill')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(page.locator('.res-picker-drag-pill')).toHaveCount(0);
    expect(await seed.chordsNow()).toEqual([{ line_index: 0, position: 0, chord_name: 'Am' }]);
  } finally {
    await seed.cleanup();
  }
});

test('hovering a chord reveals a × that deletes it', async ({ page }) => {
  const title = `E2E mouse delete ${Date.now()}`;
  const seed = await seedSongWithChord({ title, lines: LINES, chords: [{ lineIndex: 0, position: 0, name: 'Am' }] });
  try {
    await openSong(page, title);
    const pill = page.locator('.lc-pill[data-chord-id]').first();
    const remove = pill.locator('.lc-pill-remove');
    await expect(remove).toHaveCSS('opacity', '0');
    await pill.hover();
    await expect(remove).toHaveCSS('opacity', '1');
    await remove.click();
    await expect.poll(() => seed.chordsNow(), { timeout: 8000 }).toEqual([]);
  } finally {
    await seed.cleanup();
  }
});

test('Escape closes an open sheet', async ({ page }) => {
  await page.goto('/');
  await page.locator('.mobile-fab').first().click();
  await expect(page.getByText('Nuevo proyecto')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Nuevo proyecto')).toHaveCount(0);
});

test('a mouse drags a chord out of the palette onto a line', async ({ page }) => {
  const title = `E2E mouse palette ${Date.now()}`;
  const seed = await seedSongWithChord({ title, lines: LINES, chords: [] });
  try {
    await openSong(page, title);
    await page.locator('[data-line-index="1"] textarea').first().click();
    await page.getByRole('button', { name: 'Acordes y rasgueo' }).click();

    const chip = page.locator('.cs-chip').first();
    await expect(chip).toBeVisible();
    const start = centre(await chip.boundingBox());
    const end = centre(await page.locator('[data-line-index="2"]').boundingBox());
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(start.x + ((end.x - start.x) * i) / 12, start.y + ((end.y - start.y) * i) / 12);
    }
    await page.mouse.up();

    await expect(page.locator('.res-picker-drag-pill')).toHaveCount(0);
    await expect.poll(async () => (await seed.chordsNow()).length, { timeout: 8000 }).toBe(1);
  } finally {
    await seed.cleanup();
  }
});

test('a mouse can strum on the pad', async ({ page }) => {
  const title = `E2E mouse strum ${Date.now()}`;
  const seed = await seedSongWithChord({ title, lines: LINES, chords: [] });
  try {
    await openSong(page, title);
    await page.locator('[data-line-index="1"] textarea').first().click();
    await page.getByRole('button', { name: 'Acordes y rasgueo' }).click();
    await page.getByText('Rasgueo', { exact: true }).click();
    await page.getByRole('button', { name: /Grabar/ }).click();

    const pad = centre(await page.locator('.cs-pad').boundingBox());
    // One downstroke: press, drag down, release.
    await page.mouse.move(pad.x, pad.y - 40);
    await page.mouse.down();
    await page.mouse.move(pad.x, pad.y - 10, { steps: 4 });
    await page.mouse.move(pad.x, pad.y + 40, { steps: 6 });
    await page.mouse.up();

    await expect(page.locator('.cs-pattern')).toBeVisible();
  } finally {
    await seed.cleanup();
  }
});

// A real desktop browser shows scrollbars (this project runs with them on).
test('the page itself does not scroll, so nothing is measured against a scrollbar', async ({ page }) => {
  await page.setViewportSize({ width: 1692, height: 993 });
  await page.goto('/');
  await expect(page.locator('.mobile-screen').first()).toBeVisible();
  const m = await page.evaluate(() => ({
    scrollH: document.documentElement.scrollHeight, innerH: innerHeight,
    clientW: document.documentElement.clientWidth, innerW: innerWidth,
  }));
  expect(m.scrollH).toBeLessThanOrEqual(m.innerH);
  expect(m.clientW).toBe(m.innerW); // no scrollbar taking width
});

test('switching to Recursos lines the page up with the column, also after a resize', async ({ page }) => {
  await page.setViewportSize({ width: 1692, height: 993 });
  await page.goto('/');
  await expect(page.locator('.home-pager-track').first()).toBeVisible();
  await page.locator('.mobile-tabbar').getByText('Recursos', { exact: true }).click();

  const aligned = async () => page.evaluate(() => {
    const viewport = document.querySelector('.home-pager-viewport').getBoundingClientRect();
    const slides = [...document.querySelectorAll('.home-pager-track > .mobile-screen')].map((e) => e.getBoundingClientRect());
    return {
      slideWidth: Math.round(slides[1].width), viewportWidth: Math.round(viewport.width),
      // the visible page must start exactly at the left edge of the column
      offset: Math.round(slides[1].left - viewport.left),
    };
  });

  await expect.poll(async () => (await aligned()).offset, { timeout: 4000 }).toBe(0);
  let a = await aligned();
  expect(a.slideWidth).toBe(a.viewportWidth);

  await page.setViewportSize({ width: 1200, height: 800 });
  await expect.poll(async () => (await aligned()).offset, { timeout: 4000 }).toBe(0);
  a = await aligned();
  expect(a.slideWidth).toBe(a.viewportWidth);
});
