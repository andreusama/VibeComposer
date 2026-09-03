import { forwardRef } from 'react';

// A transparent-text mirror layer painted directly behind a <textarea> so
// specific character ranges can carry a coloured underline the textarea
// itself can't draw (it has no inline formatting). The textarea sits on top
// with a see-through background; this div holds the identical text in the
// identical box/font metrics, invisible except for the <mark> underlines.
//
// Used for word-variant spans (src/canvas/wordVariantData.js) on both the
// mobile per-line editor and the desktop note. `pointer-events: none` so
// every tap still reaches the textarea; the caller works out "was this tap
// on a marked span?" separately (charIndexFromPoint → resolveVariantRange).

// Splits `text` into an ordered run of { text, marked } pieces. Ranges are
// clamped to the text, sorted, and overlaps collapsed so a character is
// never wrapped twice.
export function segmentText(text, ranges) {
  const clean = (ranges || [])
    .map((r) => ({ start: Math.max(0, Math.min(r.start, text.length)), end: Math.max(0, Math.min(r.end, text.length)) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);

  const merged = [];
  for (const r of clean) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }

  const pieces = [];
  let cursor = 0;
  for (const r of merged) {
    if (r.start > cursor) pieces.push({ text: text.slice(cursor, r.start), marked: false });
    pieces.push({ text: text.slice(r.start, r.end), marked: true });
    cursor = r.end;
  }
  if (cursor < text.length) pieces.push({ text: text.slice(cursor), marked: false });
  return pieces;
}

const LineHighlight = forwardRef(function LineHighlight({ text, ranges, className = '' }, ref) {
  const pieces = segmentText(text || '', ranges);
  const cls = `line-highlight ${className}`.trim();
  if (!pieces.some((p) => p.marked)) return <div ref={ref} className={cls} aria-hidden="true" />;
  return (
    <div ref={ref} className={cls} aria-hidden="true">
      {pieces.map((p, i) => (
        p.marked
          ? <mark key={i} className="wv-underline">{p.text}</mark>
          : <span key={i}>{p.text}</span>
      ))}
      {/* a trailing space would otherwise be collapsed and shift the last mark */}
      {text?.endsWith(' ') ? '​' : null}
    </div>
  );
});

export default LineHighlight;
