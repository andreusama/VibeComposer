import { test, expect } from '@playwright/test';

// A visitor with no account taps "try the demo" and lands in a sample song.
// Runs signed OUT on purpose (empty storage state) — and each run mints one
// anonymous Supabase user, which the hourly cleanup job deletes after a day.
test.use({ storageState: { cookies: [], origins: [] } });

test('"try the demo" opens a guest session with the sample song', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'try the demo' }).tap();

  // Lands on the projects list with the seeded song.
  const song = page.getByText('Canción de ejemplo').first();
  await expect(song).toBeVisible({ timeout: 15000 });
  await song.click();

  // Two sections in the song thread, chords already placed.
  await expect(page.locator('.thread-card')).toHaveCount(2, { timeout: 10000 });
  await page.locator('.thread-card').first().click();
  await expect(page.locator('.lc-pill[data-chord-id]').first()).toBeVisible({ timeout: 10000 });

  // Voice memos are off for guests.
  const bar = page.locator('.na-head').first();
  await bar.tap();
  const record = page.locator('.na-record');
  await expect(record).toBeDisabled();
  await expect(record).toContainText('no disponible en la demo');
});

test('the app recognises the session as a guest', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'try the demo' }).tap();
  await expect(page.getByText('Canción de ejemplo').first()).toBeVisible({ timeout: 15000 });
  // isGuestNow() is what hides every upload button (Baúl, resource import, voice memos).
  expect(await page.evaluate(async () => (await import('/src/utils/guest.js')).isGuestNow())).toBe(true);
});
