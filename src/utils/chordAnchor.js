// ─── Chord layout (pure) ────────────────────────────────────────────────────
// Where chords sit across a verse, and how near-neighbours avoid colliding.
// See supabase/migration_line_chords.sql.
//
// 2026-10-16 redesign: chords used to be anchored to a specific WORD
// (anchor_text/start_offset, re-resolved against the live text on every
// render so a chord would survive edits to the text around it — the same
// idea word_variants still uses for its own underlines). That model made
// drag-and-drop fundamentally a word-level hit-test, which turned out to be
// exactly as fragile as hitting a specific word with a real finger always
// is: a drop a hair into the gap before the intended word silently
// resolved to the WRONG one and overwrote whatever chord was already
// there (reported repeatedly, most recently as "I can only place a few
// chords, every drop after that replaces the last one"). The deeper
// complaint underneath all of those reports — chords should just be a
// stackable, reorderable, overridable SEQUENCE across the verse, not
// something pinned to one specific word — was the actual fix: a chord's
// only position in the world is now its integer `position` among the
// other chords on its line (NoteEditorScreen.jsx owns reading/writing
// that), and this file no longer has any idea what the lyric text even
// says. What's left here is pure layout math: given however many chords
// are on a line, in order, how wide a slice of the line each one visually
// holds, and how their rendered pills avoid overlapping.
//
// Why "equal slices of the whole line" rather than "sized to the gap
// between one chord's word and the next" (what the old anchor-based
// version did): a verse's chord rhythm reads as regular changes across the
// line, not as whatever gap happened to separate two dropped-on words —
// and now that there's no word to size a slice by in the first place,
// equal division is simply what's left once the text content stops being
// part of the question at all.

// How much of the line a chord visually "holds" — the whole line divided
// equally among however many chords sit on it: one chord holds it all, two
// split it half and half, three a third each, and so on.
//
// `orderedChords` is trusted to already be in the order they should render
// left to right (NoteEditorScreen's chordsByLine sorts by `position`
// before handing chords down; a move-preview splices a phantom into that
// same already-sorted array) — this does NOT re-sort, so a caller that
// hands it chords in the wrong order gets them laid out in the wrong
// order, on purpose: re-sorting here would need something to sort BY, and
// the whole point of this redesign is that nothing in this file knows
// what that would even be anymore.
//
// Returns the same chords, each with its own slot's `start`/`spanEnd` as
// character offsets into the line's text — still measured in characters,
// not pixels, because LineChordStrip reads the actual glyph box for that
// span out of its text mirror via a DOM Range (the font is proportional,
// so there is no fixed character width to multiply by). `textLength` is
// the line's current text length.
export function computeChordSpans(orderedChords, textLength) {
  const list = orderedChords || [];
  const n = list.length;
  const len = textLength ?? 0;
  return list.map((c, i) => ({
    ...c,
    start: Math.round((i * len) / n),
    spanEnd: Math.round(((i + 1) * len) / n),
  }));
}

// Lay out chord pills along one visual row so near-neighbours don't
// collide. `items` are { id, left, width } in any order, `gap` the minimum
// px between two pills. Each pill keeps its measured left where it can and
// is otherwise pushed just far enough to the right to clear the previous
// one — a chord is allowed to drift right of its own slot (that still
// reads as "roughly here"), but two overlapping, half-unreadable symbols
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
