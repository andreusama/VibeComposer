// ─── "which character is under this finger?" ───────────────────────────────
// Needed by the chord drag-and-drop (ChordStrumSheet → NoteEditorScreen):
// unlike ResourcePickerSheet's drop, which only has to answer WHICH LINE the
// finger let go over, a chord has to land on a specific word inside that
// line, so the drop needs a character offset.
//
// Deliberately NOT unit-tested: every line of this is a measurement of real
// rendered glyph boxes, which jsdom does not have (it reports every rect as
// 0×0), so a test here could only assert that the mocks were called. What IS
// tested is everything the offset then feeds into — wordRangeAt /
// snapRangeToWords / resolveChordRange in chordAnchor.js. The verification
// for this file is the browser harness, not vitest.

// Two engines, two spellings, neither universal: Chromium/WebKit ship
// document.caretRangeFromPoint, Firefox ships caretPositionFromPoint.
// Feature-detected rather than sniffed.
function nativeCaretAt(x, y) {
  if (typeof document.caretPositionFromPoint === 'function') {
    const pos = document.caretPositionFromPoint(x, y);
    if (pos) return { node: pos.offsetNode, offset: pos.offset };
  }
  if (typeof document.caretRangeFromPoint === 'function') {
    const range = document.caretRangeFromPoint(x, y);
    if (range) return { node: range.startContainer, offset: range.startOffset };
  }
  return null;
}

// Walk a text node character by character and return the offset whose glyph
// box is nearest (x, y). The fallback path — and the ONLY path that is
// trustworthy over a <textarea>: both native APIs above resolve into a
// form control's internal anonymous/shadow content, where what
// startOffset means is engine-specific (Chrome has historically returned a
// child index rather than a character offset there), so a chord could land
// on the wrong word or at offset 0 with no error to notice.
//
// `mirrorEl` is the transparent text mirror that already sits behind every
// line for exactly this kind of measuring (see LineChordStrip's .lc-mirror,
// the same technique components/LineHighlight.jsx uses for variant
// underlines): a real text node, in real document flow, with the identical
// font/size/line-height/width as the textarea, so its glyph boxes are the
// textarea's glyph boxes.
export function offsetFromMirrorPoint(mirrorEl, x, y) {
  const node = mirrorEl?.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const len = node.textContent.length;
  if (!len) return 0;

  const range = document.createRange();
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < len; i += 1) {
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const rects = range.getClientRects();
    for (const r of rects) {
      if (!r.width && !r.height) continue;
      // Vertical distance dominates: a finger one line too low but
      // horizontally perfect must not win over the character actually under
      // it, so rows are compared first and the column only breaks ties
      // within a row.
      const dy = y < r.top ? r.top - y : (y > r.bottom ? y - r.bottom : 0);
      const dx = x < r.left ? r.left - x : (x > r.right ? x - r.right : 0);
      const d = dy * 1000 + dx;
      if (d < bestD) {
        bestD = d;
        // Past the glyph's own midpoint reads as "after this character",
        // which is what makes dropping on the right half of the last letter
        // of a word land on that word rather than the next one.
        best = x > r.left + r.width / 2 ? i + 1 : i;
      }
    }
  }
  return best;
}

// The one entry point callers use. Tries the native caret APIs first (they
// are cheap and exact over ordinary text), and falls back to the mirror scan
// whenever the native answer did not come back as a usable character offset
// in a text node — which, over the textarea this is actually aimed at, is
// most of the time.
export function offsetFromPoint(mirrorEl, x, y) {
  const native = nativeCaretAt(x, y);
  if (native?.node?.nodeType === Node.TEXT_NODE) {
    const text = native.node.textContent || '';
    // Only trust it when it points into the SAME text we are resolving
    // against — a native hit on the surrounding chrome, or on the
    // textarea's internal content with a child-index "offset", would
    // otherwise silently become a character position in the lyric.
    if (mirrorEl && mirrorEl.contains(native.node) && native.offset <= text.length) return native.offset;
  }
  return offsetFromMirrorPoint(mirrorEl, x, y);
}
