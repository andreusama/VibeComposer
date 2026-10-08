import { IcStrumDown, IcStrumUp } from './icons.jsx';
import { arrowSizeFor } from '../utils/strum.js';

// ─── A recorded strum pattern, drawn as literal big and little arrows ──────
// Left-to-right in performance order, each arrow's SIZE scaled by the stored
// intensity of that stroke — a hard, fast stroke is a big arrow, a soft slow
// one a small arrow. Deliberately not a bar chart, a number column or a
// velocity curve: the whole point is that the artist can glance at it and
// see their own right hand, and a row of arrows at different sizes is how
// every strum pattern has ever been written down on paper.
//
// Shared by the recorder in ChordStrumSheet.jsx and the compact read-only
// strip in NoteEditorScreen's header, so "what a strum pattern looks like"
// has exactly one definition. `min`/`max` are the only difference between
// the two (the strip is small), and `activeIndex` is the visual metronome's
// current stroke during playback.
export default function StrumArrows({ pattern, min, max, activeIndex = -1, className = '' }) {
  const strokes = pattern || [];
  if (!strokes.length) return null;
  return (
    <div className={`strum-arrows ${className}`.trim()}>
      {strokes.map((s, i) => {
        const size = arrowSizeFor(s.intensity, min, max);
        const Arrow = s.direction === 'up' ? IcStrumUp : IcStrumDown;
        return (
          <span
            key={i}
            className={`strum-arrow${i === activeIndex ? ' strum-arrow-active' : ''}`}
            /* The row is baseline-aligned, so a 44px arrow and an 18px one
               hang from the same top edge instead of being centred against
               each other — reading a strum pattern depends on the arrows
               sharing a "string" the way they do on paper. */
            style={{ height: max }}
            title={`${s.direction === 'up' ? 'arriba' : 'abajo'} · ${Math.round((s.intensity ?? 0) * 100)}%`}
          >
            <Arrow size={size} />
          </span>
        );
      })}
    </div>
  );
}
