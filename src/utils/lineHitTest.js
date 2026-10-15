// ─── "which line is under this point?" ─────────────────────────────────────
// The coarse half of the two-tier hit-test a drag-onto-a-line gesture always
// needs (NoteEditorScreen.jsx's LineRow carries data-line-index on every
// row): which line, full stop. Used for hover-highlighting during a drag
// (useLineDragDrop.js) and as the first step of resolving a drop, whether
// the drop then targets the whole line (a dropped resource) or a specific
// SLOT within its chord sequence (a dropped chord — see
// NoteEditorScreen.jsx's resolveChordDropOnLine for the finer-grained half
// of that one; chords are line-level, not word-level, as of 2026-10-16).
//
// One implementation, not one per picker: ResourcePickerSheet and
// ChordStrumSheet each grew their own copy of this exact three-liner
// independently (2026-10-08), and a scrim-hit-testing bug fixed in one
// would have stayed silently unfixed in the other had they not been merged
// back into this file (see useLineDragDrop.js's own header comment).
export function lineIndexFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  const lineEl = el?.closest('[data-line-index]');
  return lineEl ? Number(lineEl.dataset.lineIndex) : null;
}

// Every drag-onto-a-line gesture carries its payload in a floating pill
// (LineDragPill.jsx) rendered well ABOVE the raw touch point — its own CSS
// (.res-picker-drag-pill: translate(-50%, -115%)) deliberately keeps a
// finger from covering what it's aiming at. A real person watches the
// PILL, not their own finger, so hit-testing against the touch event's raw
// (x, y) resolves to wherever the finger physically is — consistently
// lower than wherever the pill visually looked like it was hovering,
// reliably by about the pill's own height (reported 2026-10-16: "the
// resource/chord drop lands on the line below the one I'm over").
//
// This reads the pill's own actual rendered center back out of the DOM and
// is what every hit-test (useLineDragDrop's hover + drop) runs against
// instead of the raw point — exact regardless of how tall the pill itself
// is (a long resource wraps taller than a short chord name). The raw point
// is still what POSITIONS the pill in the first place (LineDragPill's own
// x/y props) — only the hit-testing side switches to this.
//
// Couples this file to LineDragPill's own class name on purpose: one pill
// component, one place that knows its visual offset, rather than every
// caller re-deriving or guessing at it.
export function effectiveDragPoint(x, y) {
  const pill = document.querySelector('.res-picker-drag-pill');
  if (!pill) return { x, y };
  const r = pill.getBoundingClientRect();
  if (!r.width && !r.height) return { x, y };
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
