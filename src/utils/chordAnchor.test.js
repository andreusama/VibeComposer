import { describe, it, expect } from 'vitest';
import { spreadRow, computeChordSpans } from './chordAnchor.js';

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
  // A line's own text length only, nothing about its actual words — chords
  // are line-level as of the 2026-10-16 redesign (see this file's own
  // header comment), so the ONLY thing that decides a chord's slot is its
  // position in the ARRAY the caller hands in; this never re-sorts.
  const LEN = 24; // an arbitrary line length, matches none of the ids below on purpose
  const c = (id) => ({ id, chordName: id });

  it('a single chord holds the whole line', () => {
    const [span] = computeChordSpans([c('C')], LEN);
    expect(span.start).toBe(0);
    expect(span.spanEnd).toBe(LEN);
  });

  it('two chords split the line in half, in the order given', () => {
    const spans = computeChordSpans([c('C'), c('G')], LEN);
    expect(spans.map((s) => s.id)).toEqual(['C', 'G']);
    expect(spans[0]).toMatchObject({ start: 0, spanEnd: LEN / 2 });
    expect(spans[1]).toMatchObject({ start: LEN / 2, spanEnd: LEN });
  });

  it('trusts input order completely — reversing the input reverses the spans', () => {
    const forward = computeChordSpans([c('C'), c('G')], LEN);
    const backward = computeChordSpans([c('G'), c('C')], LEN);
    expect(backward.map((s) => s.id)).toEqual(['G', 'C']);
    expect(backward.map((s) => [s.start, s.spanEnd])).toEqual(forward.map((s) => [s.start, s.spanEnd]));
  });

  it('three chords split the line into thirds', () => {
    const spans = computeChordSpans([c('C'), c('G'), c('Am')], LEN);
    expect(spans.map((s) => s.id)).toEqual(['C', 'G', 'Am']);
    expect(spans.map((s) => s.start)).toEqual([0, Math.round(LEN / 3), Math.round((2 * LEN) / 3)]);
    expect(spans.map((s) => s.spanEnd)).toEqual([Math.round(LEN / 3), Math.round((2 * LEN) / 3), LEN]);
  });

  it('preserves every field already on the chord, not just id', () => {
    const [span] = computeChordSpans([{ id: 'x', chordName: 'C', position: 0 }], LEN);
    expect(span.chordName).toBe('C');
    expect(span.position).toBe(0);
  });

  it('returns nothing for no chords', () => {
    expect(computeChordSpans([], LEN)).toEqual([]);
  });
});
