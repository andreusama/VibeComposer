import { describe, it, expect } from 'vitest';
import { topBackdrop } from './escapeCloses.js';

// A tiny stand-in for the DOM: topBackdrop only needs querySelectorAll.
const fakeRoot = (classNames) => ({
  querySelectorAll: () => classNames.map((className) => ({ className })),
});

describe('topBackdrop', () => {
  it('picks the last (top-most) open backdrop', () => {
    const root = fakeRoot(['baul-sheet-scrim', 'ts-backdrop']);
    expect(topBackdrop(root).className).toBe('ts-backdrop');
  });

  it('leaves a backdrop alone while its sheet is being dragged out', () => {
    const root = fakeRoot(['baul-sheet-scrim', 'baul-sheet-scrim res-picker-scrim-dragging']);
    expect(topBackdrop(root).className).toBe('baul-sheet-scrim');
  });

  it('returns null when nothing is open', () => {
    expect(topBackdrop(fakeRoot([]))).toBeNull();
  });
});
