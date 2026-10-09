// ─── A recorded strum pattern, drawn as up/down beat cells ─────────────────
// Direction encoded by SIZE, not color: a down-stroke's cell is bigger
// (30×34, 10px radius) than an up-stroke's (22×22, 7px radius) — a more
// direct code to read than the solid-vs-outline color pairing this
// replaces (2026-10-08's own redesign), which made the reader map a color
// to a meaning instead of just seeing it. Every cell shares the exact same
// neutral tone (--paper-deep fill, --hairline border, --ink stroke on the
// icon) — size is the ONLY variable that carries meaning here, by design.
//
// Baseline-aligned (.strum-row's align-items: flex-end), not centred: the
// row reads as an equalizer's bars, down-strokes poking up taller than
// up-strokes, which only works if every cell shares the same bottom edge.
//
// Shared by TempoStrumCard's header strip and ChordStrumSheet's own
// "Patrón grabado" — one definition of what a strum pattern looks like,
// not two. There used to be two: this file's own predecessor (inline in
// TempoStrumCard, solid/outline cells) and a completely different
// intensity-sized bare-arrow component (StrumArrows.jsx, used only in the
// sheet) — both retired in favour of this. Each call site still owns its
// OWN eyebrow label ("Rasgueo" / "Patrón grabado") and wrapper — that part
// is genuinely different per context, not duplicated rendering logic, so
// it stays outside this component; each site gates it on the same
// emptiness this component gates its own render on, so neither ever shows
// a label over nothing.
//
// Horizontal scroll (not wrap) on overflow: an 8-stroke pattern at 320px
// scrolls within its own row rather than breaking onto a second line — a
// cell wrapping away from its own number read as broken in earlier
// testing, not as "more content below".
//
// Deliberately NOT IcStrumUp/IcStrumDown from icons.jsx: this app's whole
// icon set is one shared 1.75 stroke weight, but these cells are small and
// need a bolder 2.5/2 stroke to read clearly at this size — scoped locally
// rather than widening the shared set's one weight for this one use (same
// call TempoStrumCard's own predecessor already made).
function BeatArrow({ direction }) {
  const d = direction === 'up' ? 'M12 19V5M5 12l7-7 7 7' : 'M12 5v14M5 12l7 7 7-7';
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export default function StrumPattern({ pattern, className = '' }) {
  const strokes = pattern || [];
  if (!strokes.length) return null;
  return (
    <div className={`strum-pattern ${className}`.trim()}>
      <div className="strum-row">
        {strokes.map((s, i) => (
          <div className="beat-col" key={i}>
            <div className={`beat-cell ${s.direction}`}>
              <BeatArrow direction={s.direction} />
            </div>
          </div>
        ))}
      </div>
      <div className="beat-labels">
        {strokes.map((_, i) => <span className="beat-label" key={i}>{i + 1}</span>)}
      </div>
    </div>
  );
}
