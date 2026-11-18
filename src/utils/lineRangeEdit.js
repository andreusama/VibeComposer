// ─── Editing a selection that crosses lines ─────────────────────────────────
// The editor keeps one entry per verse line, so a selection that spans several
// lines (made over the plain-text view of the rows, see NoteEditorScreen) has
// to be cut, deleted or typed over by code, not by the browser. A range is
// two (line, offset) points; offsets are character offsets within that line's
// text, start inclusive, end exclusive.

export function normalizeRange(range) {
  const a = { line: range.startLine, offset: range.startOffset };
  const b = { line: range.endLine, offset: range.endOffset };
  const backwards = a.line > b.line || (a.line === b.line && a.offset > b.offset);
  const [from, to] = backwards ? [b, a] : [a, b];
  return { startLine: from.line, startOffset: from.offset, endLine: to.line, endOffset: to.offset };
}

const clamp = (n, max) => Math.max(0, Math.min(n, max));

// The text a range covers, lines joined with "\n" — what Copy puts on the clipboard.
export function rangeText(lines, range) {
  const { startLine, startOffset, endLine, endOffset } = normalizeRange(range);
  if (startLine === endLine) {
    const text = lines[startLine] ?? '';
    return text.slice(clamp(startOffset, text.length), clamp(endOffset, text.length));
  }
  const parts = [(lines[startLine] ?? '').slice(startOffset)];
  for (let i = startLine + 1; i < endLine; i++) parts.push(lines[i] ?? '');
  parts.push((lines[endLine] ?? '').slice(0, endOffset));
  return parts.join('\n');
}

// Replace the range with `replacement` (empty = delete / cut). The replacement
// may carry newlines — a paste, or Enter — in which case it becomes several
// lines. Returns the new lines and where the caret belongs afterwards (the end
// of what was inserted). Never mutates its input.
export function applyRangeEdit(lines, range, replacement = '') {
  const { startLine, startOffset, endLine, endOffset } = normalizeRange(range);
  const first = lines[startLine] ?? '';
  const last = lines[endLine] ?? '';
  const prefix = first.slice(0, clamp(startOffset, first.length));
  const suffix = last.slice(clamp(endOffset, last.length));
  const parts = String(replacement).replace(/\r\n?/g, '\n').split('\n');

  const middle = parts.length === 1
    ? [prefix + parts[0] + suffix]
    : [prefix + parts[0], ...parts.slice(1, -1), parts[parts.length - 1] + suffix];

  const next = [...lines.slice(0, startLine), ...middle, ...lines.slice(endLine + 1)];
  const caret = parts.length === 1
    ? { line: startLine, offset: prefix.length + parts[0].length }
    : { line: startLine + parts.length - 1, offset: parts[parts.length - 1].length };
  return { lines: next, caret };
}
