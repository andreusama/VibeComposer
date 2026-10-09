import { describe, it, expect } from 'vitest';
import { wordsIn, wordRangeAt, snapRangeToWords, resolveChordRange, sameRange, spreadRow, computeChordSpans } from './chordAnchor.js';

const LINE = 'la nit cau sobre el mar';

describe('wordsIn', () => {
  it('finds whole words, keeping internal apostrophes and interpuncts', () => {
    expect(wordsIn("l'aigua paral·lel bien-estar").map((w) => "l'aigua paral·lel bien-estar".slice(w.start, w.end)))
      .toEqual(["l'aigua", 'paral·lel', 'bien-estar']);
  });

  it('leaves trailing punctuation out of the word', () => {
    expect(wordsIn('hola, món!').map((w) => 'hola, món!'.slice(w.start, w.end))).toEqual(['hola', 'món']);
  });

  it('returns nothing for empty or wordless text', () => {
    expect(wordsIn('')).toEqual([]);
    expect(wordsIn('   ')).toEqual([]);
    expect(wordsIn(null)).toEqual([]);
  });

  it('is not confused by a previous call leaving lastIndex behind', () => {
    expect(wordsIn(LINE).length).toBe(6);
    expect(wordsIn(LINE).length).toBe(6); // the regex is module-level and global
  });
});

describe('wordRangeAt', () => {
  const at = (offset) => {
    const r = wordRangeAt(LINE, offset);
    return r ? LINE.slice(r.start, r.end) : null;
  };

  it('snaps to the whole word when the drop lands inside one', () => {
    expect(at(0)).toBe('la');
    expect(at(1)).toBe('la');
    expect(at(4)).toBe('nit');  // 'i' of nit
    expect(at(12)).toBe('sobre');
  });

  it('snaps to the nearest word from whitespace, preferring the following word on a tie', () => {
    //                                la_nit  -> offset 2 is the space; 'la' ends at 2, 'nit' starts at 3
    expect(at(2)).toBe('la');   // distance 0 to la's end, 1 to nit's start
    expect(at(10)).toBe('cau'); // the space after cau
  });

  it('prefers the following word when both are equally far', () => {
    // "ab  cd": offset 3 is one char from 'ab' (ends at 2) and one from 'cd' (starts at 4)
    const t = 'ab  cd';
    const r = wordRangeAt(t, 3);
    expect(t.slice(r.start, r.end)).toBe('cd');
  });

  it('clamps an out-of-range or missing offset instead of failing', () => {
    expect(at(999)).toBe('mar');
    expect(at(-50)).toBe('la');
    expect(at(undefined)).toBe('la');
  });

  it('returns null when there is no word to attach to', () => {
    expect(wordRangeAt('', 0)).toBeNull();
    expect(wordRangeAt('   ', 1)).toBeNull();
    expect(wordRangeAt('...', 1)).toBeNull();
  });
});

describe('snapRangeToWords', () => {
  const snap = (a, b, t = LINE) => {
    const r = snapRangeToWords(t, a, b);
    return r ? t.slice(r.start, r.end) : null;
  };

  it('grows a half-word selection out to whole words', () => {
    expect(snap(4, 6)).toBe('nit');       // 'it'
    expect(snap(1, 8)).toBe('la nit cau'); // 'a nit c'
  });

  it('keeps an already word-aligned selection intact', () => {
    expect(snap(3, 6)).toBe('nit');
    expect(snap(0, 22)).toBe(LINE);
  });

  it('collapses a whitespace-only selection to the nearest word', () => {
    expect(snap(2, 3)).toBe('la');
  });

  it('handles a collapsed caret like a drop at that caret', () => {
    expect(snap(12, 12)).toBe('sobre');
  });

  it('returns null for text with nothing to anchor to', () => {
    expect(snapRangeToWords('', 0, 0)).toBeNull();
    expect(snapRangeToWords('  ', 0, 2)).toBeNull();
  });
});

describe('resolveChordRange', () => {
  it('finds the anchor in the current text', () => {
    expect(resolveChordRange({ anchor_text: 'cau', start_offset: 7 }, LINE)).toEqual({ start: 7, end: 10 });
  });

  it('survives an edit that shifted every offset to the right', () => {
    const edited = `ja ${LINE}`; // 3 chars inserted at the front
    expect(resolveChordRange({ anchor_text: 'cau', start_offset: 7 }, edited)).toEqual({ start: 10, end: 13 });
  });

  it('uses start_offset only to disambiguate a repeated anchor', () => {
    const text = 'mar i mar i mar';
    expect(resolveChordRange({ anchor_text: 'mar', start_offset: 0 }, text)).toEqual({ start: 0, end: 3 });
    expect(resolveChordRange({ anchor_text: 'mar', start_offset: 6 }, text)).toEqual({ start: 6, end: 9 });
    expect(resolveChordRange({ anchor_text: 'mar', start_offset: 13 }, text)).toEqual({ start: 12, end: 15 });
  });

  it('detaches (null) when the anchor no longer appears at all', () => {
    expect(resolveChordRange({ anchor_text: 'cau', start_offset: 7 }, 'la nit queia sobre el mar')).toBeNull();
  });

  it('is defensive about empty/missing input', () => {
    expect(resolveChordRange({ anchor_text: '', start_offset: 0 }, LINE)).toBeNull();
    expect(resolveChordRange({ anchor_text: 'cau' }, '')).toBeNull();
    expect(resolveChordRange(null, LINE)).toBeNull();
  });

  it('accepts the camelCased shape an optimistic, unsaved chord carries', () => {
    expect(resolveChordRange({ anchorText: 'mar', startOffset: 20 }, LINE)).toEqual({ start: 20, end: 23 });
  });
});

describe('sameRange', () => {
  it('is true only for identical spans', () => {
    expect(sameRange({ start: 3, end: 6 }, { start: 3, end: 6 })).toBe(true);
    expect(sameRange({ start: 3, end: 6 }, { start: 3, end: 7 })).toBe(false);
    expect(sameRange(null, { start: 3, end: 6 })).toBe(false);
    expect(sameRange({ start: 3, end: 6 }, null)).toBe(false);
  });
});

describe('spreadRow', () => {
  it('leaves well-separated pills exactly where they were measured', () => {
    expect(spreadRow([{ id: 'a', left: 0, width: 24 }, { id: 'b', left: 120, width: 24 }]))
      .toEqual({ a: 0, b: 120 });
  });

  it('pushes a colliding pill just clear of its neighbour', () => {
    expect(spreadRow([{ id: 'a', left: 0, width: 24 }, { id: 'b', left: 10, width: 24 }], 4))
      .toEqual({ a: 0, b: 28 });
  });

  it('cascades through a cluster of three', () => {
    const out = spreadRow([
      { id: 'a', left: 0, width: 20 },
      { id: 'b', left: 4, width: 20 },
      { id: 'c', left: 8, width: 20 },
    ], 4);
    expect(out).toEqual({ a: 0, b: 24, c: 48 });
  });

  it('is independent of the order the pills arrive in', () => {
    const items = [{ id: 'b', left: 10, width: 24 }, { id: 'a', left: 0, width: 24 }];
    expect(spreadRow(items, 4)).toEqual({ a: 0, b: 28 });
  });

  it('slides the cluster back when it would run past the right edge', () => {
    // two 40px pills both measured at 170 in a 200px row: cascading alone
    // would put the second at 214, off the edge
    const out = spreadRow([{ id: 'a', left: 170, width: 40 }, { id: 'b', left: 170, width: 40 }], 4, 200);
    expect(out.b + 40).toBeLessThanOrEqual(200);
    expect(out.b - (out.a + 40)).toBeGreaterThanOrEqual(4);
    expect(out.a).toBeGreaterThanOrEqual(0);
  });

  it('never pushes a pill off the left edge while making room', () => {
    const out = spreadRow([
      { id: 'a', left: 90, width: 40 },
      { id: 'b', left: 90, width: 40 },
      { id: 'c', left: 90, width: 40 },
    ], 4, 100);
    expect(out.a).toBe(0);
    expect(out.b).toBe(44);
    expect(out.c).toBe(88);
  });

  it('handles an empty row', () => {
    expect(spreadRow([])).toEqual({});
  });
});

describe('computeChordSpans', () => {
  // 'la nit cau sobre el mar' — la(0-2) nit(3-6) cau(7-10) sobre(11-16) el(17-19) mar(20-23)
  // Takes chords already resolved to {start, end} — the shape
  // NoteEditorScreen's chordsByLine actually hands LineChordStrip, which
  // is what calls this (see that file's own comment on why it doesn't
  // re-resolve anchors itself).
  const c = (id, start, end) => ({ id, start, end });

  it('a single chord gets the remaining space — spans to the end of the line', () => {
    const [span] = computeChordSpans([c('C', 3, 6)], LINE.length);
    expect(span.start).toBe(3);
    expect(span.spanEnd).toBe(LINE.length);
  });

  it('a second chord shrinks the first one to end where the new one begins', () => {
    const spans = computeChordSpans([c('C', 3, 6), c('G', 11, 16)], LINE.length);
    expect(spans.map((s) => s.id)).toEqual(['C', 'G']);
    expect(spans[0].spanEnd).toBe(11); // C now stops where G starts
    expect(spans[1].spanEnd).toBe(LINE.length); // G, now last, gets the rest
  });

  it('is unaffected by the order chords are passed in', () => {
    const forward = computeChordSpans([c('C', 3, 6), c('G', 11, 16)], LINE.length);
    const backward = computeChordSpans([c('G', 11, 16), c('C', 3, 6)], LINE.length);
    expect(backward.map((s) => [s.id, s.spanEnd])).toEqual(forward.map((s) => [s.id, s.spanEnd]));
  });

  it('a middle chord is bounded by both neighbours', () => {
    const spans = computeChordSpans([c('C', 3, 6), c('G', 11, 16), c('Am', 20, 23)], LINE.length);
    expect(spans.map((s) => s.spanEnd)).toEqual([11, 20, LINE.length]);
  });

  it('never shrinks narrower than the chord\'s own anchor word, even with no gap at all', () => {
    // "la" (0-2) immediately followed by "nit" (3-6) — nothing between them.
    const spans = computeChordSpans([c('C', 0, 2), c('G', 3, 6)], LINE.length);
    expect(spans[0].spanEnd).toBe(3); // not negative, not before its own end (2)
  });

  it('preserves every field already on the chord, not just start/end', () => {
    const [span] = computeChordSpans([{ id: 'C', start: 3, end: 6, chordName: 'C' }], LINE.length);
    expect(span.chordName).toBe('C');
  });

  it('returns nothing for no chords', () => {
    expect(computeChordSpans([], LINE.length)).toEqual([]);
  });
});
