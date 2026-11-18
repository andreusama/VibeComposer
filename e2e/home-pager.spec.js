import { test, expect } from '@playwright/test';
import { touchSwipe } from './fixtures/touch.js';

// Proyectos / Recursos are two pages of one horizontal strip. On a phone the tab
// bar and a swipe both move it; the resting position is a percentage of the
// pager's own width (it used to be window.innerWidth in pixels).

const pageOffset = (page, i) => page.evaluate((idx) => {
  const viewport = document.querySelector('.home-pager-viewport').getBoundingClientRect();
  const slide = document.querySelectorAll('.home-pager-track > .mobile-screen')[idx].getBoundingClientRect();
  return Math.round(slide.left - viewport.left);
}, i);

test('the tab bar and a swipe both move between Proyectos and Recursos', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.home-pager-track')).toBeVisible();
  expect(await pageOffset(page, 0)).toBe(0);

  await page.locator('.mobile-tabbar').getByText('Recursos', { exact: true }).tap();
  await expect.poll(() => pageOffset(page, 1), { timeout: 4000 }).toBe(0);

  // Swipe right (finger moves left → right) to go back to Proyectos.
  const box = await page.locator('.home-pager-viewport').boundingBox();
  const y = box.y + box.height / 2;
  await touchSwipe(page, { from: { x: box.x + box.width * 0.2, y }, to: { x: box.x + box.width * 0.85, y }, steps: 8, durationMs: 220 });
  await expect.poll(() => pageOffset(page, 0), { timeout: 4000 }).toBe(0);
});
