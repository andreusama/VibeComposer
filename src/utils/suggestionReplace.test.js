import { describe, it, expect } from 'vitest';
import { applySuggestionToLine } from './suggestionReplace.js';

// The line from the bug report: one word selected, and the Muse answered
// with a full rewritten line.
const verse = { before: 'Pots ', text: 'mirar-ho', after: ' diferent,' };

describe('applySuggestionToLine', () => {
  it("scope 'selection' replaces only the selected fragment", () => {
    expect(applySuggestionToLine(verse, 'veure-ho', 'selection')).toBe('Pots veure-ho diferent,');
  });

  it("scope 'line' replaces the whole line, not just the selection (the reported duplication)", () => {
    const out = applySuggestionToLine(verse, "Pots mirar-m'ho d'un altre punt,", 'line');
    expect(out).toBe("Pots mirar-m'ho d'un altre punt,");
    expect(out).not.toContain('Pots mirar-ho');
  });

  it('a whole-line selection behaves the same for both scopes', () => {
    const whole = { before: '', text: 'Pots mirar-ho diferent,', after: '' };
    expect(applySuggestionToLine(whole, 'Pots veure-ho diferent,', 'selection')).toBe('Pots veure-ho diferent,');
    expect(applySuggestionToLine(whole, 'Pots veure-ho diferent,', 'line')).toBe('Pots veure-ho diferent,');
  });

  it('a selection at the very start of the line keeps the tail', () => {
    const start = { before: '', text: 'Pots', after: ' mirar-ho diferent,' };
    expect(applySuggestionToLine(start, 'Podem', 'selection')).toBe('Podem mirar-ho diferent,');
  });

  it('a selection at the very end of the line keeps the head', () => {
    const end = { before: 'Pots mirar-ho ', text: 'diferent', after: '' };
    expect(applySuggestionToLine(end, 'millor', 'selection')).toBe('Pots mirar-ho millor');
  });

  it("reproduces the reported output exactly when scope is ignored, and fixes it with 'line'", () => {
    // The reported result ("Pots mirar-ho Pots mirar-m'ho d'un altre punt,,")
    // can only come from this selection: "diferent" with "," after it.
    const tail = { before: 'Pots mirar-ho ', text: 'diferent', after: ',' };
    const suggestion = "Pots mirar-m'ho d'un altre punt,";
    expect(applySuggestionToLine(tail, suggestion, 'line')).toBe(suggestion);
    expect(applySuggestionToLine(tail, suggestion, 'selection')).toBe("Pots mirar-ho Pots mirar-m'ho d'un altre punt,");
  });

  it("does not double punctuation when a 'selection' suggestion already ends with the mark that follows it", () => {
    const mid = { before: 'Pots ', text: 'mirar-ho', after: ', diferent' };
    expect(applySuggestionToLine(mid, 'veure-ho,', 'selection')).toBe('Pots veure-ho, diferent');
    expect(applySuggestionToLine({ before: 'a ', text: 'b', after: '.' }, 'c.', 'selection')).toBe('a c.');
  });

  it('does not double punctuation at the end of a selection-scoped end-of-line fragment', () => {
    const end = { before: 'Pots mirar-ho ', text: 'diferent,', after: '' };
    expect(applySuggestionToLine(end, 'millor,', 'selection')).toBe('Pots mirar-ho millor,');
  });

  it("only collapses a single repeated mark, never real repeats like '...'", () => {
    expect(applySuggestionToLine({ before: 'a ', text: 'b', after: '' }, 'c...', 'selection')).toBe('a c...');
  });

  it("falls back to 'selection' (the pre-contract behavior) when scope is missing or unknown", () => {
    expect(applySuggestionToLine(verse, 'veure-ho')).toBe('Pots veure-ho diferent,');
    expect(applySuggestionToLine(verse, 'veure-ho', 'bogus')).toBe('Pots veure-ho diferent,');
  });
});
