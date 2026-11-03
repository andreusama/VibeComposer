// How a Muse suggestion lands in the line it was asked about.
//
// The contract (also stated to the model in museApi.js's output format):
// every SURGEON/ARCHITECT suggestion carries a `scope` —
//   'selection': text replaces ONLY the selected fragment (before/after stay)
//   'line':      text IS the whole rewritten line (before/after are dropped)
// Splicing a 'line' suggestion between before/after is what duplicated the
// surrounding text ("Pots mirar-ho Pots mirar-m'ho d'un altre punt,,"), so the
// scope has to come from the model, not be guessed from the text. A missing or
// unknown scope falls back to 'selection', the editor's behavior before the
// contract existed (also what word-bank picks always mean).

export const SUGGESTION_SCOPES = ['selection', 'line'];

const TRAILING_MARK = /[,.;:!?…]$/;

export function normalizeScope(scope) {
  return SUGGESTION_SCOPES.includes(scope) ? scope : 'selection';
}

// targetVerse: { before, text, after } — the same shape NoteEditorScreen tracks.
export function applySuggestionToLine(targetVerse, suggestionText, scope) {
  if (normalizeScope(scope) === 'line') return suggestionText;
  const { before, after } = targetVerse;
  let text = suggestionText;
  // A fragment that already ends with the mark that follows the selection
  // would double it ("punt,,"). Drop exactly one, and never touch real
  // repeats like an ellipsis ("...").
  if (TRAILING_MARK.test(text) && after.startsWith(text.slice(-1)) && !text.endsWith(text.slice(-1).repeat(2))) {
    text = text.slice(0, -1);
  }
  return before + text + after;
}
