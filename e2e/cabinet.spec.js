import { test, expect } from '@playwright/test';
import { touchSwipe } from './fixtures/touch.js';
import { seedSongWithChord } from './fixtures/seed.js';

// The Baúl's glass cabinet waits just left of the song screen. On a phone it is
// opened with the arrow handle or a swipe from the left, closed with its X.
test('the cabinet opens with the handle and with a swipe, and closes again', async ({ page }) => {
  const title = `E2E cabinet touch ${Date.now()}`;
  const seed = await seedSongWithChord({ title, lines: ['Una linea', 'Otra linea'], chords: [] });
  try {
    await page.goto('/');
    await page.getByPlaceholder('Buscar').first().fill(title);
    await page.getByText(title).first().click();
    await expect(page.locator('.thread-card').first()).toBeVisible();

    const paneLeft = async () => Math.round((await page.locator('.cab-pane').boundingBox()).x);

    await page.locator('.cab-handle').tap();
    await expect.poll(paneLeft, { timeout: 4000 }).toBe(0);
    await page.locator('.cab-close').tap();
    await expect.poll(async () => (await page.locator('.cab-pane').boundingBox()).x < 0, { timeout: 4000 }).toBe(true);

    // A swipe to the right, started clear of the system-back edge.
    const y = 500;
    await touchSwipe(page, { from: { x: 60, y }, to: { x: 330, y }, steps: 8, durationMs: 220 });
    await expect.poll(paneLeft, { timeout: 4000 }).toBe(0);
  } finally {
    await seed.cleanup();
  }
});
