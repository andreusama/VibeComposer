---
name: qa-layout-stability
description: Audit and live-test VibeComposer for unexpected layout shift while typing or interacting — nearby elements jumping, spacing changing, or things sliding around as a side effect of a state change that shouldn't visually touch them. This is what makes an app feel "clunky" even when nothing is functionally broken. Use this whenever asked to check for jank, layout jumps, shifting UI, or a "clunky" feel, and proactively after adding anything that resizes, measures, or reflows based on typed input or async data (an auto-growing textarea, a badge/count that appears late, a chord pill positioned off a measured mirror).
---

# QA: typing and interacting must only move what you're touching

## Why this matters more than it sounds like it should

Functionally-correct UI can still feel broken if things move that the person didn't touch. Typing
in one line and watching the line below it twitch, or a card elsewhere on screen nudge over by a
pixel, reads as "something's wrong" even when the data is fine — it breaks the expectation that
typing is a self-contained action affecting only the thing being typed into. This is a real,
reportable class of bug distinct from "it doesn't work", and it's usually caused by one of a small
number of concrete mechanisms, not randomness — find the mechanism, don't just eyeball the result.

## Where this app already gets it right — know the working pattern before hunting for breaks

`NoteEditorScreen.jsx`'s line auto-resize is the model to measure new code against:

```js
useLayoutEffect(() => {
  const el = localRef.current;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}, [displayedText, chords?.length]);
```

Two things make this safe rather than janky:
- **`useLayoutEffect`, not `useEffect`** — it runs synchronously before the browser paints, so the
  resize happens in the SAME frame as the text change. A plain `useEffect` here would paint the
  wrong (stale) height for one frame, then visibly snap to the right one a tick later — a flash, not
  a smooth resize, even though the end state is identical.
- **The dependency array matches everything that actually changes the rendered height** — not just
  `displayedText` but also `chords?.length`, because a line gaining its first chord pill triggers
  `.ne-row-has-chords` CSS (extra `line-height`/`padding-top` to make room for the pill above the
  text), which changes `scrollHeight` without `displayedText` itself having changed. Missing a
  dependency here is exactly how "it resizes correctly most of the time, but not when X happens" bugs
  get introduced — the fix isn't a different mechanism, it's a more complete dependency list.

`.ne-row-has-chords`'s own comment is worth internalizing as a general principle: when ONE measured
element (the chord-pill-positioning mirror) and ONE rendered element (the real textarea) have to
agree on metrics, keeping their CSS in the exact same rule (not two separately-maintained rules that
happen to currently match) is what prevents them silently drifting apart later. A pill that's
correctly positioned today but drifts out of alignment after an unrelated CSS tweak six months from
now is a layout-stability bug with a long fuse — flag ANY place a measurement and a render are kept
in sync by convention rather than by sharing one source.

## Checklist

- **Does a resize block paint, or does it flash?** Any new auto-sizing behavior (a textarea, a card
  that grows to fit content) — is it `useLayoutEffect` (synchronous, before paint) or `useEffect`
  (next tick, async)? The latter is correct for things that don't need to be glitch-free on the very
  first frame; it is NOT correct for something resizing in direct response to the user's own typing,
  where they're watching the exact pixel they just typed at.
- **Does late-arriving async content reserve its own space in advance?** A badge, a syllable count,
  a chord's "has history" icon — if it only renders once data arrives, does ITS OWN addition push
  sibling content around? Prefer reserving the space up front (even empty) over having neighbors
  shift when content fills in. Check specifically: does anything in the gutter/metadata area of a
  line (`.ne-gutter` and friends) render conditionally in a way that could change row height once
  async data (rhyme, friction, history) resolves after the row was already painted?
- **Scroll position across a layout change.** Inserting a new line, attaching a chord, or anything
  that changes a block's total height above the user's current viewport position — does the scroll
  position hold steady (so content already on screen doesn't visually jump), or does the browser's
  default scroll-anchoring behavior end up fighting with a manual scroll adjustment somewhere?
- **Absolute-positioned overlays measured off a sibling that can change size.** `LineChordStrip`'s
  pill layer is the concrete example in this codebase — its positions are computed from a DOM Range
  measured against `.lc-mirror`, which has to have IDENTICAL font/size/line-height/padding to the
  real `.ne-line-input` textarea it's drawn over, or pills land over the wrong words. Any new overlay
  built the same way (measure a hidden/mirror element, position pills/badges/highlights absolutely
  over a different real element) needs the same scrutiny: are the two elements' relevant CSS
  properties coming from the literal same rule, or two rules a future edit could desync?
- **Does a sheet/popover opening or closing shift the content behind it**, rather than overlaying it
  (a scrim + fixed-position sheet shouldn't reflow the page underneath)?

## Live-testing methodology

Code review tells you a mechanism COULD be safe; only measuring confirms it IS. The direct way to
catch this with Playwright: read the bounding box of elements that should NOT move, before and after
the interaction, and assert they didn't.

```js
// Elements that should stay put while typing into a DIFFERENT line — pick
// real candidates: a sibling line below the one being typed into, the FAB,
// the bottom tab bar/accessory bar.
const watched = ['.ne-row:nth-child(2)', 'button.mobile-fab', '.mobile-tabbar'];
const before = {};
for (const sel of watched) {
  const box = await page.locator(sel).first().boundingBox().catch(() => null);
  if (box) before[sel] = box;
}

await page.locator('.ne-line-input').first().click();
await page.keyboard.type('Each keystroke should only affect this one line', { delay: 30 });
await page.waitForTimeout(200); // let any effect settle

for (const sel of watched) {
  const box = await page.locator(sel).first().boundingBox().catch(() => null);
  if (!box || !before[sel]) continue;
  const moved = Math.abs(box.x - before[sel].x) > 0.5 || Math.abs(box.y - before[sel].y) > 0.5;
  console.log(`${sel}: ${moved ? 'MOVED — ' + JSON.stringify({ before: before[sel], after: box }) : 'stable'}`);
}
```

For a finer-grained check (catching a one-frame flash a before/after snapshot would miss), sample
mid-typing rather than only before and after the whole string — take a bounding-box reading after
EVERY keystroke (or every few) instead of once at the end, which is what actually exposes a
`useEffect`-instead-of-`useLayoutEffect` flash.

Also specifically test the async-arrival case directly: trigger whatever causes a line's gutter
content to populate late (a rhyme classification, a friction flag, a history entry appearing) and
confirm neighboring lines' positions don't shift when it resolves — this needs the interaction that
actually produces async content, not just typing.

Write throwaway `_pw_<name>.mjs` scripts at the project root, same convention as the other QA
skills; delete once the finding is confirmed.

## Reporting

For each shift found: which element moved, by how much, what triggered it, and — the useful part —
which category it falls into (missing `useLayoutEffect`, an incomplete effect dependency list, space
not reserved for late content, a measurement/render pair that drifted apart) so a fix targets the
actual mechanism rather than papering over the symptom with a hardcoded min-height that'll break
again the next time the content changes shape.
