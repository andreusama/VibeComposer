import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { spreadRow } from '../utils/chordAnchor.js';

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
  return ka.every((k) => b[k] && Math.abs(a[k].left - b[k].left) < 0.5 && Math.abs(a[k].top - b[k].top) < 0.5);
};

export default function LineChordStrip({ text, chords, onRemove }) {
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

    list.forEach((c) => {
      const el = pillRefs.current[c.id];
      const start = Math.max(0, Math.min(c.start, len));
      const end = Math.max(start, Math.min(c.end, len));
      range.setStart(node, start);
      range.setEnd(node, end);
      // getClientRects()[0], not getBoundingClientRect(): an anchor that
      // wraps across two visual rows has two rects, and the chord belongs
      // over where the phrase STARTS — the union rect would put it
      // somewhere between the two, aligned to neither.
      const rect = range.getClientRects()[0] || range.getBoundingClientRect();
      const rowCenter = rect.top + rect.height / 2 - base.top;
      const key = Math.round(rowCenter);
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push({ id: c.id, left: rect.left - base.left, width: el ? el.offsetWidth : 0 });
      tops[c.id] = rowCenter - GLYPH_H / 2 - PILL_LIFT - (el ? el.offsetHeight : 0);
    });

    const next = {};
    rows.forEach((items) => {
      const lefts = spreadRow(items, PILL_GAP, base.width);
      items.forEach((it) => { next[it.id] = { left: lefts[it.id], top: tops[it.id] }; });
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
              <span
                key={c.id}
                ref={(el) => { if (el) pillRefs.current[c.id] = el; else delete pillRefs.current[c.id]; }}
                className={`lc-pill${armedId === c.id ? ' lc-pill-armed' : ''}`}
                style={p ? { left: p.left, top: p.top } : { left: 0, top: 0, visibility: 'hidden' }}
                onClick={() => arm(c.id)}
              >
                {c.chordName}
                {armedId === c.id && (
                  <button
                    className="lc-pill-remove"
                    onClick={(e) => { e.stopPropagation(); clearTimeout(armTimerRef.current); setArmedId(null); onRemove?.(c.id); }}
                    title="quitar este acorde"
                  >×</button>
                )}
              </span>
            );
          })}
        </div>
      )}
    </>
  );
}
