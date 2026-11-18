import { test, expect } from '@playwright/test';
import { seedSongWithChord } from './fixtures/seed.js';

// Opening a share link WITHOUT signing in: the song's final read-through,
// read-only, no session created (docs/adr/0003). Runs signed out on purpose.
// Needs supabase/migration_shared_readonly_link.sql applied.
test.use({ storageState: { cookies: [], origins: [] } });

const LINES = ['Primera linea de prueba', 'Segunda linea de prueba'];

async function seed(title) {
  return seedSongWithChord({ title, lines: LINES, chords: [{ lineIndex: 0, position: 0, name: 'Am' }] });
}

test('a link opened without an account shows the song read-only', async ({ page }) => {
  const title = `E2E shared ${Date.now()}`;
  const s = await seed(title);
  try {
    const code = await s.invite();
    await page.goto(`/?invite=${code}`);

    await expect(page.locator('.perf-title')).toHaveText(title, { timeout: 15000 });
    await expect(page.getByText('Primera linea de prueba')).toBeVisible();
    await expect(page.locator('.lc-pill').first()).toHaveText('Am');
    await expect(page.locator('.shared-banner')).toContainText('solo lectura');
    await expect(page.getByRole('button', { name: 'Inicia sesión para editar' })).toBeVisible();

    // Read-only means nothing on the page can be typed into, and looking made no session.
    await expect(page.locator('textarea')).toHaveCount(0);
    const hasSession = await page.evaluate(() => Object.keys(localStorage).some((k) => k.includes('auth-token')));
    expect(hasSession).toBe(false);
  } finally {
    await s.cleanup();
  }
});

test('a view-only link offers no way to edit', async ({ page }) => {
  const s = await seed(`E2E viewonly ${Date.now()}`);
  try {
    const code = await s.invite({ viewOnly: true });
    await page.goto(`/?invite=${code}`);
    await expect(page.locator('.shared-banner')).toContainText('solo lectura', { timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Inicia sesión para editar' })).toHaveCount(0);
  } finally {
    await s.cleanup();
  }
});

test('a revoked link says so instead of spinning', async ({ page }) => {
  const s = await seed(`E2E revoked ${Date.now()}`);
  try {
    const code = await s.invite({ revoked: true });
    await page.goto(`/?invite=${code}`);
    await expect(page.getByText('El propietario ha desactivado este enlace.')).toBeVisible({ timeout: 15000 });
  } finally {
    await s.cleanup();
  }
});

test('"Inicia sesión para editar" leads to sign-in, then into the song', async ({ page }) => {
  const title = `E2E join ${Date.now()}`;
  const s = await seed(title);
  try {
    const code = await s.invite();
    await page.goto(`/?invite=${code}`);
    await page.getByRole('button', { name: 'Inicia sesión para editar' }).click();

    // The sign-in screen — it must NOT bounce back to the read-only view.
    await expect(page.getByRole('button', { name: 'sign in with password' })).toBeVisible();
    await expect(page.locator('.shared-banner')).toHaveCount(0);

    await page.getByPlaceholder('you@example.com').fill(process.env.PLAYWRIGHT_TEST_EMAIL);
    await page.getByPlaceholder('password', { exact: true }).fill(process.env.PLAYWRIGHT_TEST_PASSWORD);
    await page.getByRole('button', { name: 'sign in with password' }).click();

    // Signed in with an account: the link joins the song and opens it for editing.
    await expect(page.locator('.thread-card').first()).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.shared-banner')).toHaveCount(0);
  } finally {
    await s.cleanup();
  }
});
