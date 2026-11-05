import { test, expect } from '@playwright/test';
import { seedSongWithChord } from './fixtures/seed.js';

// On a wide screen the app is shown inside a phone-sized frame, and a plain
// desktop MOUSE has to be able to do the touch-only gestures in it.

test('a wide screen shows the mobile app in a phone frame', async ({ page }) => {
  await page.goto('/');
  const frame = page.locator('.phone-frame-screen');
  await expect(frame).toBeVisible();
  const box = await frame.boundingBox();
  expect(box.width).toBeLessThanOrEqual(412); // phone-width, not the 1280px window

  // The app inside really is the mobile layout (projects pager, not the canvas).
  const inner = page.frameLocator('.phone-frame-screen');
  await expect(inner.getByPlaceholder('Buscar').first()).toBeVisible();
  await expect(page.locator('.react-flow')).toHaveCount(0);
});

test('?desktop=1 skips the frame (developer escape hatch)', async ({ page }) => {
  await page.goto('/?desktop=1');
  await expect(page.locator('.phone-frame-screen')).toHaveCount(0);
});

test('a mouse can long-press and drag a placed chord inside the frame', async ({ page }) => {
  const title = `E2E desktop frame ${Date.now()}`;
  const seed = await seedSongWithChord({
    title,
    lines: ['Primera linea de prueba', 'Segunda linea de prueba', 'Tercera linea de prueba'],
    chords: [{ lineIndex: 0, position: 0, name: 'Am' }],
  });
  try {
    await page.goto('/');
    const inner = page.frameLocator('.phone-frame-screen');
    await inner.getByPlaceholder('Buscar').first().fill(title);
    await inner.getByText(title).first().click();
    await inner.locator('.thread-card').first().click();

    const pill = inner.locator('.lc-pill[data-chord-id]').first();
    await expect(pill).toBeVisible();
    const pillBox = await pill.boundingBox();
    const target = await inner.locator('[data-line-index="2"]').boundingBox();
    const start = { x: pillBox.x + pillBox.width / 2, y: pillBox.y + pillBox.height / 2 };
    const end = { x: target.x + target.width / 2, y: target.y + target.height / 2 };

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.waitForTimeout(500); // past the long-press threshold
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(start.x + ((end.x - start.x) * i) / 12, start.y + ((end.y - start.y) * i) / 12);
      await page.waitForTimeout(40);
    }
    await page.mouse.up();

    await expect(inner.locator('.res-picker-drag-pill')).toHaveCount(0);
    await expect.poll(() => seed.chordsNow(), { timeout: 8000 }).toEqual([
      { line_index: 2, position: 0, chord_name: 'Am' },
    ]);
  } finally {
    await seed.cleanup();
  }
});

// Dev-tools device mode → back to a wide window: the page must come back as the
// phone frame, not as the old desktop canvas layout.
test('widening a phone-sized window brings the phone frame back', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 900 });
  await page.goto('/');
  await expect(page.locator('.phone-frame-screen')).toHaveCount(0);
  await expect(page.getByPlaceholder('Buscar').first()).toBeVisible(); // bare mobile layout, signed in

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('.phone-frame-screen')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.react-flow')).toHaveCount(0);
});

test('narrowing a framed window drops the frame', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.phone-frame-screen')).toBeVisible();
  await page.setViewportSize({ width: 412, height: 900 });
  await expect(page.locator('.phone-frame-screen')).toHaveCount(0, { timeout: 5000 });
  await expect(page.getByPlaceholder('Buscar').first()).toBeVisible();
});
