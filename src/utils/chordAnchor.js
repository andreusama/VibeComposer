// ─── Chord anchoring (pure) ────────────────────────────────────────────────
// Where a chord sits inside a line of lyric text, and how that survives the
// text being edited around it. See supabase/migration_line_chords.sql.
//
// The governing idea, copied deliberately from word variants
// (resolveVariantRange, src/canvas/wordVariantData.js) rather than invented
// again here: a stored character offset is NOT trusted after the fact. Type
// one word at the start of a line and every offset to its right is wrong.
// So the attachment's real identity is its anchor_text — the actual
// substring the chord was dropped on — and its position is re-derived from
// the CURRENT text on every render. start_offset only survives as a
// tie-breaker for "which 'y' did they mean" when the anchor appears more
// than once, and the chord simply stops being drawn when its anchor is gone
// from the line entirely (detached, not deleted — exactly how a word
// variant whose active wording was typed over behaves).

// A "word" for chord purposes: starts on a letter or digit and may carry
// internal apostrophes/hyphens/interpuncts, so Catalan/Spanish forms like
// "l'aigua", "paral·lel" and "bien-estar" count as one word and the chord
// doesn't end up anchored to a bare fragment. Trailing punctuation
// (commas, periods, ¿?¡!) is deliberately left OUT of the anchor: it is not
// part of the sung syllable, and including it would make the anchor break
// on an unrelated punctuation edit.
const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’·\-]*/gu;

// Every word in `text`, in order, as { start, end }.
export function wordsIn(text) {
  if (!text) return [];
  const out = [];
  WORD_RE.lastIndex = 0;
  let m;
  while ((m = WORD_RE.exec(text)) !== null) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

// The word a drop at character `offset` should attach to.
//
// Inside a word → that word, always: a finger that genuinely landed in the
// middle of "corazón" means that word, and splitting it at the exact
// character under the fingertip would be precision theatre — real tablature
// puts the symbol over a whole word/syllable, never over half a letter.
//
// In whitespace or punctuation → the nearest word, and on a tie the word
// that FOLLOWS the drop point, because a chord change is heard as landing
// with the next thing sung, not as trailing the previous one.
//
// Returns null only when there is no word at all to attach to.
export function wordRangeAt(text, offset) {
  const words = wordsIn(text);
  if (!words.length) return null;
  const pos = Math.max(0, Math.min(Number.isFinite(offset) ? offset : 0, text.length));

  const inside = words.find((w) => pos >= w.start && pos < w.end);
  if (inside) return { ...inside };

  let best = words[0];
  let bestD = Infinity;
  for (const w of words) {
    const d = pos < w.start ? w.start - pos : pos - w.end;
    if (d < bestD || (d === bestD && w.start > pos)) { bestD = d; best = w; }
  }
  return { ...best };
}

// Grow a raw [start, end) — typically a native text selection, which users
// habitually leave half a letter short — out to whole word boundaries, so a
// hand-added chord anchors to the same kind of span a dropped one does.
// Collapses to a single word when the range carries no word at all (e.g.
// the user selected only a space).
export function snapRangeToWords(text, start, end) {
  if (!text) return null;
  const lo = Math.max(0, Math.min(start ?? 0, text.length));
  const hi = Math.max(lo, Math.min(end ?? lo, text.length));
  const words = wordsIn(text);
  const touched = words.filter((w) => w.start < hi && w.end > lo);
  // A collapsed caret, or a selection of nothing but spaces/punctuation.
  if (!touched.length) return wordRangeAt(text, lo);
  return { start: touched[0].start, end: touched[touched.length - 1].end };
}

// Re-locate a stored chord's span in the line's current text. Returns
// { start, end } or null when the anchor no longer appears (detached).
//
// Accepts both the DB row shape (anchor_text / start_offset) and the
// already-camelCased shape the sheet hands around before a row exists, so
// an optimistic, not-yet-persisted chord renders through the same path as a
// loaded one.
export function resolveChordRange(chord, lineText) {
  const needle = chord?.anchor_text ?? chord?.anchorText ?? '';
  if (!needle || !lineText) return null;

  const bias = chord?.start_offset ?? chord?.startOffset ?? 0;
  let best = null;
  let bestDelta = Infinity;
  let from = 0;
  for (;;) {
    const idx = lineText.indexOf(needle, from);
    if (idx === -1) break;
    const delta = Math.abs(idx - bias);
    if (delta < bestDelta) { bestDelta = delta; best = idx; }
    from = idx + 1;
  }
  return best == null ? null : { start: best, end: best + needle.length };
}

// How much of the line a chord visually "holds" — the whole line divided
// equally among however many chords sit on it: one chord holds it all, two
// split it half and half, three a third each, and so on. Deliberately NOT
// "from this word until the next chord's word" (an earlier version of this
// function worked that way, sized by actual word gaps) — a verse's chord
// rhythm reads as regular changes across the line, not as whatever gap
// happened to separate two dropped-on words, and equal division is also
// what makes "drag a chord to reorder it" (NoteEditorScreen's handleMoveChord)
// a coherent gesture: moving a chord earlier/later in the sequence visibly
// resizes every segment around it, the same way dragging a fencepost would.
//
// ORDER is still decided by each chord's own anchor (`start`, from
// resolveChordRange) — re-anchoring a chord via a drag is exactly what
// changes its position in that order, so "reorganize" needs no separate
// position field, just the existing anchor machinery. WIDTH is not: a
// chord's own anchor word only ever decides which slot it's in, never how
// big that slot is.
//
// Takes chords ALREADY resolved to live positions — numeric `start`/`end`
// on each (LineChordStrip's own `list`, built upstream by NoteEditorScreen's
// chordsByLine via resolveChordRange) — rather than re-resolving anchors
// itself, since the caller already did that work and a second pass would
// just re-scan the same text for nothing. `textLength` is the line's
// current text length, divided evenly among however many chords there are.
//
// Returns the same chords, sorted left-to-right, each with its own slot's
// `start`/`spanEnd` — note this OVERWRITES `start` (the anchor's own
// position is no longer where the slot begins): the return value is a
// rendering-only view, never fed back into anything that resolves anchors.
export function computeChordSpans(resolvedChords, textLength) {
  const sorted = [...(resolvedChords || [])].sort((a, b) => a.start - b.start || a.end - b.end);
  const n = sorted.length;
  const len = textLength ?? 0;
  return sorted.map((c, i) => ({
    ...c,
    start: Math.round((i * len) / n),
    spanEnd: Math.round(((i + 1) * len) / n),
  }));
}

// Two chords occupy "the exact same range" (Part A: dropping onto a span
// that already has a chord REPLACES it rather than stacking a second
// symbol on the identical word) when their re-resolved spans coincide.
// Compared on the resolved range, not on the stored offsets — stored
// offsets of two chords on the same word can legitimately differ if they
// were attached at different points in the line's editing history.
export function sameRange(a, b) {
  return !!a && !!b && a.start === b.start && a.end === b.end;
}

// Lay out chord pills along one visual row so near-neighbours don't
// collide. `items` are { id, left, width } in any order, `gap` the minimum
// px between two pills. Each pill keeps its measured left where it can and
// is otherwise pushed just far enough to the right to clear the previous
// one — a chord is allowed to drift right of its word (that still reads as
// "this word, roughly here"), but two overlapping, half-unreadable symbols
// read as nothing at all. Returns a map id → left.
//
// Pure and separately tested because it is the one bit of the overlay that
// is genuinely easy to get subtly wrong, and impossible to eyeball once
// three chords land on the same short line.
export function spreadRow(items, gap = 4, maxRight = Infinity) {
  const sorted = [...items].sort((a, b) => a.left - b.left || String(a.id).localeCompare(String(b.id)));
  const out = {};
  let cursor = -Infinity;
  for (const it of sorted) {
    const left = Math.max(it.left, cursor);
    out[it.id] = left;
    cursor = left + it.width + gap;
  }
  // Everything got pushed past the right edge — slide the whole row back so
  // the last pill ends at the edge rather than disappearing off it.
  const last = sorted[sorted.length - 1];
  if (last && Number.isFinite(maxRight)) {
    const overflow = out[last.id] + last.width - maxRight;
    if (overflow > 0) {
      let floor = 0;
      for (const it of sorted) {
        const shifted = Math.max(floor, out[it.id] - overflow);
        out[it.id] = shifted;
        floor = shifted + it.width + gap;
      }
    }
  }
  return out;
}
