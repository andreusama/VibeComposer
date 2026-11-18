import { test, expect } from '@playwright/test';
import { seedSongWithChord } from './fixtures/seed.js';

// A line shows as plain text until it is edited, then becomes a text field. That
// swap must not move anything — on a phone, where lines wrap and a hidden field
// that stayed in the row would halve the width and double the height.
test('turning a line into a field does not change any row on a phone', async ({ page }) => {
  const title = `E2E editor layout ${Date.now()}`;
  const seed = await seedSongWithChord({
    title,
    lines: ['Primera linea de prueba', 'Una segunda linea bastante mas larga para que se parta en dos', 'Tercera'],
    chords: [{ lineIndex: 0, position: 0, name: 'Am' }],
  });
  try {
    await page.goto('/');
    await page.getByPlaceholder('Buscar').first().fill(title);
    await page.getByText(title).first().click();
    await page.locator('.thread-card').first().click();
    await expect(page.locator('.ne-line-view').first()).toBeVisible();
    // Chords load a moment after the text and make their line taller; measure after.
    await expect(page.locator('.lc-pill').first()).toBeVisible();

    const measure = () => page.locator('.ne-row').evaluateAll((els) => els.map((e) => {
      const r = e.getBoundingClientRect();
      return [Math.round(r.top), Math.round(r.height)];
    }));
    const before = await measure();

    await page.locator('[data-line-index="1"] .ne-line-view').tap();
    await expect(page.locator('[data-line-index="1"] .ne-line-view')).toHaveCount(0);
    const after = await measure();

    expect(after).toHaveLength(before.length);
    before.forEach(([top, height], i) => {
      expect(Math.abs(top - after[i][0])).toBeLessThanOrEqual(1);
      expect(Math.abs(height - after[i][1])).toBeLessThanOrEqual(1);
    });
  } finally {
    await seed.cleanup();
  }
});
