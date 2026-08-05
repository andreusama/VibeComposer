// A note's textarea holds one or more physical lines (rows) of lyric text.
// The syllable counter and the rhyme module both need to work per physical
// line, not on the whole block as one string — this is the one place that
// decides what "a line" means so both stay consistent.
//
// Blank lines are kept as empty-string entries (not filtered out): callers
// that need to align something visually to a textarea row (rhyme badges)
// depend on the returned index matching the row index exactly.
export function splitIntoLines(text) {
  return (text || '').split('\n').map((l) => l.replace(/\r$/, '').trim());
}
