import { test, expect } from '@playwright/test';

// On a phone the input mode is touch, and it stays touch through taps — the
// touch gesture code (docs/adr/0002) must keep owning those.
test('a phone is in touch mode', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-input', 'touch');
  await page.getByPlaceholder('Buscar').first().tap();
  await expect(page.locator('html')).toHaveAttribute('data-input', 'touch');
  // The hover-only affordances of mouse mode are not on the page.
  await expect(page.locator('.mp-row-hover-delete')).toHaveCount(0);
});
