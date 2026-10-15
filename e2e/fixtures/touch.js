// ─── Real, trusted touch gestures via CDP ──────────────────────────────────
// Playwright's own page.touchscreen is tap-only — no held-then-moved
// gesture, which is exactly the shape every drag in this app uses
// (src/mobile/useLongPressDrag.js: hold past LONG_PRESS_MS, then move).
// This goes one level lower, straight to the Chrome DevTools Protocol's own
// Input.dispatchTouchEvent — the same mechanism Playwright's touch
// emulation itself is built on. That's what makes it able to catch the
// native-gesture-arbitration bugs this app has hit twice (reported
// 2026-10-09, 2026-10-15): these are TRUSTED, engine-level events the
// browser's own touch-action/scroll-claiming logic reacts to exactly like
// a real finger would — unlike a TouchEvent constructed and dispatched
// from page-context JS (document.dispatchEvent(new TouchEvent(...))),
// which the engine's native gesture recognition never sees at all, so a
// test built that way could never have caught either bug.

// CDP silently drops a touchMove/touchEnd that doesn't carry the SAME `id`
// as the touchStart that began it — without an explicit id, Chromium
// doesn't recognize later calls as continuing the same touch sequence at
// all, and the move/end events never reach the page (confirmed directly:
// an identical sequence with no id produced zero touchmove listeners
// firing; adding id:1 throughout fixed it immediately). Every helper below
// threads the same id through its whole sequence for exactly this reason —
// easy to lose if this file is ever restructured, so it's centralized here
// rather than repeated as a magic number in each function.
const TOUCH_ID = 1;

// One held-then-dragged gesture — long-press a chip/pill, move it across
// however many waypoints, release at the last one. `holdMs` has to clear
// useLongPressDrag's own LONG_PRESS_MS (380ms) before the first waypoint,
// or the gesture reads as "released early", not a drag.
export async function touchDrag(page, { start, waypoints, holdMs = 450, stepDelayMs = 40 }) {
  const cdp = await page.context().newCDPSession(page);
  const point = (p) => [{ x: p.x, y: p.y, id: TOUCH_ID }];

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(start) });
  await page.waitForTimeout(holdMs);

  let last = start;
  for (const wp of waypoints) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(wp) });
    await page.waitForTimeout(stepDelayMs);
    last = wp;
  }

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: point(last) });
}

// A plain tap — press and release with no real movement, well under
// LONG_PRESS_MS, so it reads as a tap rather than a drag-start.
export async function touchTap(page, point, { holdMs = 60 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y, id: TOUCH_ID }] });
  await page.waitForTimeout(holdMs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: point.x, y: point.y, id: TOUCH_ID }] });
}

// A real swipe sampled over several intermediate points and real elapsed
// time — StrumPad's continuous-gesture segmenter (utils/strum.js) reads
// direction/intensity off genuine touchmove samples, not a single A-to-B
// jump, so this is what exercises it honestly (including, with the right
// waypoints, a mid-gesture direction reversal — one continuous touch
// decomposed into two strokes).
export async function touchSwipe(page, { from, to, steps = 6, durationMs = 180 }) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y, id: TOUCH_ID }] });
  const stepDelay = durationMs / steps;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    // eslint-disable-next-line no-await-in-loop
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: TOUCH_ID }] });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(stepDelay);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: to.x, y: to.y, id: TOUCH_ID }] });
}
