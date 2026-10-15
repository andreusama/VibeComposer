import { test as setup, expect } from '@playwright/test';

// ─── Signs in once, reused by every other test via storageState ───────────
// Password auth specifically (not magic link): there's no email inbox for
// a CI runner to check, and this is also exactly the method
// src/screens/auth.js was given for fast, no-round-trip sign-in — the same
// reason it's fast for a human iterating is why it's the only one that
// works for an automated runner at all. Account is a real but throwaway
// one (see .env.local's own comment) created via Supabase's REST API
// directly, not through this flow.
const EMAIL = process.env.PLAYWRIGHT_TEST_EMAIL;
const PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD;

const authFile = 'e2e/.auth/user.json';

setup('authenticate', async ({ page }) => {
  if (!EMAIL || !PASSWORD) {
    throw new Error(
      'PLAYWRIGHT_TEST_EMAIL / PLAYWRIGHT_TEST_PASSWORD are not set. '
      + 'Local: put them in .env.local. CI: set them as repo secrets.',
    );
  }

  await page.goto('/');
  await page.getByPlaceholder('you@example.com').fill(EMAIL);
  await page.getByPlaceholder('password (optional)').fill(PASSWORD);
  await page.getByRole('button', { name: 'sign in with password' }).click();

  // Signed in once the auth card is gone — whatever screen we land on
  // after that (home/loading/etc.) is real app, not the sign-in gate.
  await expect(page.locator('.auth-card')).toHaveCount(0, { timeout: 15_000 });

  await page.context().storageState({ path: authFile });
});
