---
name: qa-drag-drop-lifecycle
description: Audit and live-test every long-press-and-drag gesture in VibeComposer (dragging a chord or resource onto a verse, reordering a placed chord, anything built on useLongPressDrag/useLineDragDrop) for a broken lifecycle — a drag that starts but never lets you drop, a gesture that silently dies partway through, or state that stays stuck "mid-drag" after the sheet closes or the finger lifts somewhere unexpected. Use this after touching ANY drag-and-drop code, and proactively whenever asked to check for stuck UI, frozen gestures, or things that "stop working until you try again".
---

# QA: a drag must always reach a real end state

## The one root cause behind nearly every drag bug found in this app so far

A touch's `touchmove`/`touchend` events are **permanently bound to whichever DOM element received
the `touchstart`**, for the entire gesture, regardless of where the finger moves. This is the DOM
spec's own behavior, not a bug in this app's code — but it has one sharp consequence: **if that
original element is removed from the document before the finger lifts, those events have nowhere
left to go.** Not an error. Not a cancelled gesture. The events are simply never delivered again.
Whatever state the drag was in when the element vanished is the state it's stuck in, forever, until
something unrelated resets it.

This exact mechanism caused multiple real, separately-reported bugs in this session, each looking
like a different symptom on the surface:

- **The chip grid unmounting the instant a drag starts** (ChordStrumSheet/ResourcePickerSheet used
  to swap their whole rendered content for a collapsed strip the moment `onDragStart` fired) — "drag
  picks up, then the sheet just freezes."
- **A chord's own phantom preview silently omitted from the render** whenever the drag resolved to
  "replace itself" (the hit-test found the chord's own un-moved pill right where the drag started) —
  the array passed to React that render had no element with that chord's `key` in it at all, so React
  tore down the real pill's DOM node mid-gesture, same effect as the first bug, different trigger.
  Fixed by excluding the dragged item from its own hit-test.
  (`src/mobile/NoteEditorScreen.jsx` — `resolveChordDropOnLine`'s `excludeChordId` param,
  `previewChordsByLine`'s "always render the phantom somewhere" fallback.)
- **The exact same class, a third way:** the phantom being omitted whenever the drag hovered
  somewhere with no valid drop target at all (between lines, off any row) — "informative on its own"
  was the original reasoning, but it also meant the dragged element's key dropped out of the render
  on that exact tick, with the same unmount consequence if the finger was still down.

The pattern to look for is always the same question: **for every tick of an active drag, is there
guaranteed to be SOME element in the render carrying the same identity (React `key`, or just "the
same DOM node") as whatever received the original `touchstart`?** If a conditional ever answers "no"
— even for one render, even in an edge case that "shouldn't" happen — that's the bug.

## Checklist, beyond the root cause above

- **touchcancel**: does every drag's origin element handle it, and does it leave the UI in a clean
  "nothing is happening" state (not a half-started drag with no way to finish it)? A real OS can
  cancel a touch sequence outright (an incoming call, a system gesture) — this isn't a hypothetical.
- **Closing the sheet / navigating away mid-drag**: if a drag is in progress and the sheet that owns
  it (or the whole screen) closes through some OTHER path — the back button, the scrim being tapped
  (should be disabled mid-drag, but verify), the song/project being deleted from under you — does the
  drag's own document-level listeners (`useLineDragDrop.js`) get torn down, or do they linger,
  waiting for a touchend that will never come because the component watching for it unmounted?
- **The floating drag pill's own visual offset.** `LineDragPill` renders well above the raw touch
  point (`translate(-50%, -115%)`, so a dragging finger doesn't cover what it's aiming at) — a real
  person aims by watching the PILL, not their own finger. Any new hit-test logic for a drop MUST go
  through `effectiveDragPoint` (`src/utils/lineHitTest.js`), not the raw `(x, y)` a touch event
  reports — using the raw point resolves to wherever the finger physically is, which is reliably
  offset from wherever the drag visually looks like it's hovering. (This was a real, separately-found
  bug: resource drops landing a whole line below where they visually appeared to be.)
- **Self-targeting**: can a drag's own drop-resolution logic ever find the thing being dragged as
  the answer to "what's under this point right now"? If a move-drag's hit-test doesn't explicitly
  exclude the dragged item, the instant the gesture starts (finger hasn't moved yet) it's still
  sitting exactly where it always was — a naive hit-test finds itself.
- **Multiple drags racing**: can two separate long-press timers both be live at once (e.g., two
  fingers, or a second long-press starting before the first one's timer fired)? `useLongPressDrag`'s
  state is per-component-instance — confirm nothing GLOBAL (module-level state, a single shared ref)
  could let one gesture's cleanup clobber another's.

## Live-testing methodology

**Use real, trusted touch events — not synthetic DOM `TouchEvent` construction.** This project's
`e2e/fixtures/touch.js` dispatches through the Chrome DevTools Protocol's own
`Input.dispatchTouchEvent`, the same low-level mechanism Playwright's own touch emulation is built
on. The reason this matters, not just a style preference: these are TRUSTED, engine-level events
that the browser's native touch-action/scroll-claiming and element-targeting logic reacts to exactly
like a real finger — a `document.dispatchEvent(new TouchEvent(...))` from page-context JS never
reaches that native layer at all, so a test built that way structurally cannot catch any of the bugs
described above. If you're reproducing a drag bug and reach for a synthetic event because it's
easier to wire up, stop — it will not reproduce the failure.

Use the existing helpers directly:

```js
import { touchDrag, touchTap, touchSwipe } from './e2e/fixtures/touch.js';

await touchDrag(page, {
  start: { x, y },                 // the chip/pill's own center
  waypoints: [ /* intermediate points */ { x, y } ],
  holdMs: 450,                     // must clear useLongPressDrag's own ~380ms threshold
  stepDelayMs: 100,
});
```

**One real trap in the helper's own touch IDs**, already fixed once and worth not re-breaking: every
touch point across a single gesture's touchstart→touchmove→touchend sequence needs the SAME `id`
field — without it, Chromium doesn't recognize later calls as continuing the same touch at all, and
moves get silently dropped. `touch.js`'s `TOUCH_ID` constant exists for exactly this; don't introduce
a second touch helper that forgets it.

**Aiming at a target**: because of the floating-pill offset (see checklist above), a touch coordinate
equal to where you WANT the drop to visually land is not where you should send the raw touch — the
pill will be rendered above it. Correct for this the way the existing repros do, by iteratively
reading the actual rendered `.res-picker-drag-pill` back out and nudging the touch point until the
PILL's own center matches the target, not the raw coordinate:

```js
let fx = desiredX, fy = desiredY + 60; // seed below target; the pill offset pulls it up
for (let i = 0; i < 6; i++) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: fx, y: fy, id: 1 }] });
  await page.waitForTimeout(100);
  const pillBox = await page.locator('.res-picker-drag-pill').boundingBox();
  if (!pillBox) break;
  const errX = desiredX - (pillBox.x + pillBox.width / 2);
  const errY = desiredY - (pillBox.y + pillBox.height / 2);
  if (Math.abs(errX) < 2 && Math.abs(errY) < 2) break;
  fx += errX; fy += errY;
}
```

For each gesture under test, verify at minimum:
1. **The happy path completes**: full touchstart→move(s)→touchend delivered (log every touch event
   received at `document` level if a gesture seems to die partway — `0` touchmoves after touchstart,
   or touchmoves stopping abruptly, is the signature of the unmount bug above), and the drop lands
   where it visually should.
2. **An interrupted gesture recovers cleanly**: fire `touchcancel` instead of `touchend` mid-drag, or
   close the owning sheet via another path mid-drag, then confirm no residual "stuck dragging" visual
   state remains and a fresh gesture on the same element still works immediately after.
3. **Re-running a move or placement immediately after** (not just once) — a gesture that works the
   FIRST time but leaves something subtly broken for the second attempt is exactly the stuck-toolbar
   bug class from `qa-infinite-loading`'s sibling concern (focus not restored, a bottom bar stuck
   showing the wrong thing) — check `KeyboardAccessoryBar`/`NoteAudioBar`'s visibility too, not just
   whether the drag itself completed.

Write throwaway `_pw_<name>.mjs` scripts at the project root for each repro, same convention as this
session established; delete them once the finding is confirmed fixed (or confirmed as a real,
reported finding if not fixing it yourself).

## Reporting

For each gesture audited: what was tested (happy path / cancel / interrupted-by-navigation), what
the touch-event log showed, and for anything broken — name which of the checklist's specific
failure shapes it matches, since "the drag doesn't work" is much less actionable than "the origin
pill's key drops out of the array when the hover resolves to no valid target, same as the
2026-10-20 fix, just on a different code path."
