// ─── "which line is under this point?" ─────────────────────────────────────
// The coarse half of the two-tier hit-test a drag-onto-a-line gesture always
// needs (NoteEditorScreen.jsx's LineRow carries data-line-index on every
// row): which line, full stop. Used for hover-highlighting during a drag
// (useLineDragDrop.js) and as the first step of resolving a drop, whether
// the drop then targets the whole line (a dropped resource) or a specific
// word inside it (a dropped chord — see caretFromPoint.js's offsetFromPoint
// for the finer-grained half of that one).
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
