import { describe, it, expect } from 'vitest';
import { normalizeRange, rangeText, applyRangeEdit } from './lineRangeEdit.js';

const LINES = ['Primera linea', 'Segunda linea', 'Tercera linea', 'Cuarta'];
const r = (startLine, startOffset, endLine, endOffset) => ({ startLine, startOffset, endLine, endOffset });

describe('normalizeRange', () => {
  it('leaves a forward range alone and flips a backwards one', () => {
    expect(normalizeRange(r(0, 2, 1, 3))).toEqual(r(0, 2, 1, 3));
    expect(normalizeRange(r(2, 4, 0, 1))).toEqual(r(0, 1, 2, 4));
    expect(normalizeRange(r(1, 5, 1, 2))).toEqual(r(1, 2, 1, 5));
  });
});

describe('rangeText', () => {
  it('reads part of one line', () => {
    expect(rangeText(LINES, r(0, 0, 0, 7))).toBe('Primera');
  });

  it('reads across lines: the tail of the first, whole middle lines, the head of the last', () => {
    expect(rangeText(LINES, r(0, 8, 2, 7))).toBe('linea\nSegunda linea\nTercera');
  });

  it('clamps offsets that overshoot a line', () => {
    expect(rangeText(LINES, r(3, 0, 3, 99))).toBe('Cuarta');
  });
});

describe('applyRangeEdit', () => {
  it('deleting inside one line leaves the other lines alone', () => {
    const out = applyRangeEdit(LINES, r(1, 0, 1, 8), '');
    expect(out.lines).toEqual(['Primera linea', 'linea', 'Tercera linea', 'Cuarta']);
    expect(out.caret).toEqual({ line: 1, offset: 0 });
  });

  it('deleting across lines merges the first line head with the last line tail', () => {
    const out = applyRangeEdit(LINES, r(0, 8, 2, 7), '');
    expect(out.lines).toEqual(['Primera  linea', 'Cuarta']);
    expect(out.caret).toEqual({ line: 0, offset: 8 });
  });

  it('typing over a cross-line selection replaces it with the typed text', () => {
    const out = applyRangeEdit(LINES, r(0, 8, 2, 7), 'X');
    expect(out.lines).toEqual(['Primera X linea', 'Cuarta']);
    expect(out.caret).toEqual({ line: 0, offset: 9 });
  });

  it('pasting several lines over a selection splits it into new lines', () => {
    const out = applyRangeEdit(['uno', 'dos', 'tres'], r(0, 1, 1, 1), 'AAA\nBBB\nCCC');
    expect(out.lines).toEqual(['uAAA', 'BBB', 'CCCos', 'tres']);
    expect(out.caret).toEqual({ line: 2, offset: 3 });
  });

  it('Enter over a selection splits the line at the selection', () => {
    const out = applyRangeEdit(['abcdef'], r(0, 2, 0, 4), '\n');
    expect(out.lines).toEqual(['ab', 'ef']);
    expect(out.caret).toEqual({ line: 1, offset: 0 });
  });

  it('works on a range selected backwards, and on a whole-text selection', () => {
    expect(applyRangeEdit(LINES, r(2, 7, 0, 8), '').lines).toEqual(['Primera  linea', 'Cuarta']);
    expect(applyRangeEdit(['a', 'b'], r(0, 0, 1, 1), '').lines).toEqual(['']);
  });

  it('normalises CRLF and lone CR in what is pasted', () => {
    const out = applyRangeEdit(['x'], r(0, 0, 0, 1), 'a\r\nb\rc');
    expect(out.lines).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input', () => {
    const input = ['a', 'b', 'c'];
    applyRangeEdit(input, r(0, 0, 2, 1), '');
    expect(input).toEqual(['a', 'b', 'c']);
  });
});
