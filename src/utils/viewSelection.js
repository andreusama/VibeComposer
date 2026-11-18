import { normalizeRange } from './lineRangeEdit.js';

// ─── Browser selection → (line, offset) points ──────────────────────────────
// Lines that aren't being edited are drawn as plain text (.ne-line-view), so a
// drag from one line into another is an ordinary browser selection across
// ordinary elements. These helpers turn that selection into the line/offset
// range lineRangeEdit.js works on. DOM-only; exercised by the e2e suite.

const ZERO_WIDTH = /​/g; // an empty line draws one, so it keeps its height

// Characters of `viewEl`'s text before the point (node, offset).
export function offsetInView(viewEl, node, offset) {
  const range = document.createRange();
  range.setStart(viewEl, 0);
  try { range.setEnd(node, offset); } catch { return 0; }
  return range.toString().replace(ZERO_WIDTH, '').length;
}

function elementOf(node) {
  return node.nodeType === 1 ? node : node.parentElement;
}

// One endpoint of the selection → { line, offset }, or null if it is outside the rows.
function pointToLine(node, offset, root) {
  const el = elementOf(node);
  if (!el || !root.contains(el)) return null;
  const row = el.closest('[data-line-index]');
  if (!row) return null;
  const line = Number(row.dataset.lineIndex);
  const view = row.querySelector('.ne-line-view');
  // The row being edited (a textarea) or the empty "next line" slot has no view.
  if (!view) return { line, offset: 0 };
  if (view.contains(node)) return { line, offset: offsetInView(view, node, offset) };
  // The point sits somewhere else in the row (gutter, padding): before the text or after it.
  const before = view.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING;
  return { line, offset: before ? 0 : view.textContent.replace(ZERO_WIDTH, '').length };
}

// The current selection as a normalised range over the rows inside `root`, or
// null when there is none worth acting on (collapsed, in a text field, or
// outside the rows).
export function viewSelectionToRange(root) {
  const sel = window.getSelection();
  if (!root || !sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const active = document.activeElement;
  if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) return null;
  const a = pointToLine(sel.anchorNode, sel.anchorOffset, root);
  const f = pointToLine(sel.focusNode, sel.focusOffset, root);
  if (!a || !f) return null;
  return normalizeRange({ startLine: a.line, startOffset: a.offset, endLine: f.line, endOffset: f.offset });
}

export function sameRange(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.startLine === b.startLine && a.startOffset === b.startOffset
    && a.endLine === b.endLine && a.endOffset === b.endOffset;
}

// Where, in a view's text, a click landed — for putting the caret there when a
// line turns into a text field. Falls back to the end of the line.
export function caretOffsetFromPoint(viewEl, x, y) {
  let node = null;
  let off = 0;
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (pos) { node = pos.offsetNode; off = pos.offset; }
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (r) { node = r.startContainer; off = r.startOffset; }
  }
  if (!node || !viewEl.contains(node)) return viewEl.textContent.replace(ZERO_WIDTH, '').length;
  return offsetInView(viewEl, node, off);
}
