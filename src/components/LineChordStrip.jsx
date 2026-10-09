import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { spreadRow, computeChordSpans } from '../utils/chordAnchor.js';
import useLongPressDrag from '../mobile/useLongPressDrag.js';

// ─── Chord symbols sitting above the exact words they're strummed on ───────
// "Mainstream tablature": a chord pill horizontally aligned to the precise
// character range of the lyric it belongs to, the way Ultimate-Guitar-style
// sheets print it — see supabase/migration_line_chords.sql.
//
// The alignment problem: the lyric lives in a real <textarea> in a
// proportional font, so there is no character width to multiply by and no
// way to ask the textarea where character 14 is. The only reliable answer is
// to measure it — so this renders a transparent text MIRROR of the line
// (identical font/size/line-height/width/padding, so identical glyph boxes)
// and reads each chord's span out of it with a DOM Range. The same mirror
// technique components/LineHighlight.jsx already uses to draw word-variant
// underlines a textarea can't draw itself; this one measures instead of
// painting.
//
// The mirror is rendered for EVERY line, not only chorded ones, because it
// is also the hit-test surface the chord drag-and-drop resolves a drop's
// character offset against (utils/caretFromPoint.js) — a line with no chords
// yet is precisely the line you are about to drop the first one onto.

const PILL_GAP = 4; // minimum px between two pills on the same visual row

// Approximate glyph box (ascent + descent) of the 17px lyric font. Needed
// because a chorded row carries extra leading (see .ne-row-has-chords in
// style.css) and the pill belongs in that leading, just above the words —
// so the top of the TEXT has to be worked out from the row's vertical
// centre rather than read off the Range's rect directly. Engines disagree
// about whether a Range rect's height is the line box or the font's own
// box, but both agree it is CENTRED on the text, which is why everything
// below is derived from the centre and GLYPH_H instead of from rect.height.
const GLYPH_H = 22;
const PILL_LIFT = 1; // px of air between the bottom of a pill and the text

// How long a tapped pill stays armed with its delete affordance before it
// gives up and goes back to being just a chord symbol. Long enough to reach
// for, short enough that a stray tap doesn't leave an × hovering over the
// lyric indefinitely.
const ARM_TIMEOUT_MS = 2600;

// One shared empty array for the (very common) chordless line, so its
// measuring effect isn't re-entered on every keystroke just because `|| []`
// minted a new array identity.
const NO_CHORDS = [];

const samePlacement = (a, b) => {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => (
    b[k]
    && Math.abs(a[k].left - b[k].left) < 0.5
    && Math.abs(a[k].top - b[k].top) < 0.5
    && Math.abs(a[k].width - b[k].width) < 0.5
  ));
};

// One placed pill. Tap → arm its delete ×; long-press → lift it and drag it
// onto a different word (same useLongPressDrag.js timing ChordStrumSheet's
// palette chips use to start THEIR drag — this is the third picker that
// gesture now serves, exactly what it was pulled out for). The live drag
// itself is owned by NoteEditorScreen (useLineDragDrop.js), not here: a
// dragged pill routinely crosses onto a DIFFERENT line's own
// ChordPillView/LineChordStrip instance, so nothing below the editor
// itself can be the one thing guaranteed to outlive the gesture — same
// reasoning ChordChip and ResourcePickerRow's own comments give for why
// they hand the drag off rather than track it locally.
function ChordPillView({ chord: c, placement: p, armed, onArm, onDismissArm, onRemove, onMoveStart, pillRef }) {
  const lp = useLongPressDrag({ onDragStart: (payload, x, y) => onMoveStart?.(payload, x, y) });

  // A preview entry (NoteEditorScreen's previewChordsByLine): the phantom
  // this SAME chord would occupy here if the in-flight drag ended right
  // now. Not the real thing yet — no delete ×, no re-drag (the finger
  // already holding the real one hasn't let go), just a dashed outline so
  // the layout change reads as "about to happen", not "already happened".
  if (c.preview) {
    return (
      <span
        ref={pillRef}
        className="lc-pill lc-pill-preview"
        style={p ? { left: p.left, top: p.top, width: p.width } : { left: 0, top: 0, visibility: 'hidden' }}
      >
        {c.chordName}
      </span>
    );
  }

  return (
    <span
      ref={pillRef}
      className={`lc-pill${armed ? ' lc-pill-armed' : ''}`}
      style={p ? { left: p.left, top: p.top, width: p.width } : { left: 0, top: 0, visibility: 'hidden' }}
      onTouchStart={(e) => { const t = e.touches[0]; lp.start(t.clientX, t.clientY, { id: c.id, chordName: c.chordName }); }}
      onTouchMove={(e) => { const t = e.touches[0]; lp.move(t.clientX, t.clientY); }}
      onTouchEnd={lp.end}
      onTouchCancel={lp.end}
      onClick={() => { if (!lp.moved()) onArm(); }}
    >
      {c.chordName}
      {armed && (
        <button
          className="lc-pill-remove"
          onClick={(e) => { e.stopPropagation(); onDismissArm(); onRemove?.(c.id); }}
          title="quitar este acorde"
        >×</button>
      )}
    </span>
  );
}

export default function LineChordStrip({ text, chords, onRemove, onMoveStart }) {
  const mirrorRef = useRef(null);
  const pillRefs = useRef({});
  const [placement, setPlacement] = useState({}); // id → { left, top }
  const [armedId, setArmedId] = useState(null);
  const armTimerRef = useRef(null);

  const list = chords || NO_CHORDS;

  useEffect(() => () => clearTimeout(armTimerRef.current), []);

  // Any change to the chords on this line retires a stale armed pill — the
  // × must never outlive the chord it belonged to.
  useEffect(() => { setArmedId(null); }, [chords]);

  const arm = useCallback((id) => {
    setArmedId((cur) => (cur === id ? null : id));
    clearTimeout(armTimerRef.current);
    armTimerRef.current = setTimeout(() => setArmedId(null), ARM_TIMEOUT_MS);
  }, []);

  // useLayoutEffect, not useEffect: the pills are rendered hidden and only
  // become visible once they have a measured position, so this has to run
  // before paint or every edit would flash a column of chords at x=0.
  useLayoutEffect(() => {
    const mirror = mirrorRef.current;
    if (!mirror) return;
    if (!list.length) { setPlacement((cur) => (Object.keys(cur).length ? {} : cur)); return; }
    const node = mirror.firstChild;
    if (!node || node.nodeType !== 3) return;

    const base = mirror.getBoundingClientRect();
    const len = node.textContent.length;
    const range = document.createRange();
    // Grouped by visual row (a long line wraps, and a chord on the second
    // wrapped row must not be de-collided against one on the first).
    const rows = new Map();
    const tops = {};
    const spans = computeChordSpans(list, len);

    spans.forEach((c) => {
      const el = pillRefs.current[c.id];
      const start = Math.max(0, Math.min(c.start, len));
      // Measured out to the computed SPAN end, not the chord's own anchor
      // word — a chord's pill is drawn as wide as the EQUAL SLICE of the
      // line it holds (chordAnchor.js's computeChordSpans: one chord holds
      // the whole line, two split it in half, three a third each), not as
      // wide as the gap to the next dropped-on word. That slice can be
      // narrower than the label itself needs (a short slice, a long chord
      // name) — .lc-pill's own min-width:fit-content (style.css) is what
      // floors it there, not this measurement.
      const spanEnd = Math.max(start, Math.min(c.spanEnd, len));
      range.setStart(node, start);
      range.setEnd(node, spanEnd);
      // getClientRects()[0], not getBoundingClientRect(): a span that
      // wraps across two visual rows has two rects, and the chord belongs
      // over where the phrase STARTS — the union rect would put it
      // somewhere between the two, aligned to neither. (A span wrapping
      // is rare — spans stop at the next chord — but a long gap to a
      // distant next chord, or to the end of a long last line, can still
      // do it.)
      const rect = range.getClientRects()[0] || range.getBoundingClientRect();
      const rowCenter = rect.top + rect.height / 2 - base.top;
      const key = Math.round(rowCenter);
      if (!rows.has(key)) rows.set(key, []);
      // A small gap before the next chord's pill, so two adjacent spans
      // never look like one fused bar.
      const width = Math.max(0, rect.width - PILL_GAP);
      rows.get(key).push({ id: c.id, left: rect.left - base.left, width });
      tops[c.id] = rowCenter - GLYPH_H / 2 - PILL_LIFT - (el ? el.offsetHeight : 0);
    });

    const next = {};
    rows.forEach((items) => {
      const lefts = spreadRow(items, PILL_GAP, base.width);
      items.forEach((it) => { next[it.id] = { left: lefts[it.id], top: tops[it.id], width: it.width }; });
    });
    setPlacement((cur) => (samePlacement(cur, next) ? cur : next));
  }, [text, list]);

  return (
    <>
      {/* The measuring/hit-testing mirror. Plain text in a single text node
          on purpose — a Range needs one, and it is also what
          offsetFromMirrorPoint walks character by character. */}
      <div ref={mirrorRef} className="line-highlight lc-mirror" aria-hidden="true">{text || ''}</div>

      {list.length > 0 && (
        /* aria-hidden: the chords are decoration over a textarea whose value
           a screen reader already reads; announcing "Am" mid-sentence from a
           separate layer would interleave into the lyric. The chord list is
           reachable as real content from the sheet instead. */
        <div className="lc-layer" aria-hidden="true">
          {list.map((c) => {
            const p = placement[c.id];
            return (
              <ChordPillView
                key={c.id}
                chord={c}
                placement={p}
                armed={armedId === c.id}
                onArm={() => arm(c.id)}
                onDismissArm={() => { clearTimeout(armTimerRef.current); setArmedId(null); }}
                onRemove={onRemove}
                onMoveStart={onMoveStart}
                pillRef={(el) => { if (el) pillRefs.current[c.id] = el; else delete pillRefs.current[c.id]; }}
              />
            );
          })}
        </div>
      )}
    </>
  );
}
