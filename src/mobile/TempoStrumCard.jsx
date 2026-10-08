// ─── Tempo + Rasgueo header card ────────────────────────────────────────────
// Redesign of the old plain-text ".ne-strum-strip" ("75 BPM ↑ ↓ ↑ ↑", one
// weight, no structure) into two blocks split by a hairline: TEMPO (pulsing
// dot + big serif number) and RASGUEO (solid/outline beat cells, one per
// recorded stroke). Purely visual — same data this already received
// (strum.bpm / strum.pattern), same tap-to-reopen-the-recorder behavior,
// no new interactivity on the cells themselves. See the design spec this
// was built from (2026-10-08) for the exact tokens/measurements.
//
// Reuses .tempo-pulse-dot's own `tempo-pulse-beat` keyframe (TempoPulse.jsx)
// rather than a new animation — same "pulses at the actual rhythm" trick,
// animation-duration = 60000/bpm ms, not a fixed rate.
//
// The beat-cell arrows are NOT IcStrumUp/IcStrumDown from icons.jsx: this
// app's whole icon set is deliberately one shared stroke weight (1.75, see
// icons.jsx's own header comment), but these cells are small (30px) and
// need a bolder 2.5 stroke to read clearly — exactly the low-contrast
// problem this redesign exists to fix. Scoped locally rather than widening
// the shared set's one weight for a single use.
function BeatArrow({ direction }) {
  const d = direction === 'up' ? 'M12 19V5M5 12l7-7 7 7' : 'M12 5v14M5 12l7 7 7-7';
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export default function TempoStrumCard({ bpm, strumPattern, onClick }) {
  const strokes = strumPattern || [];
  const hasStrum = strokes.length > 0;
  if (!bpm) return null;

  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      className={`ne-tempo-strum-card${hasStrum ? '' : ' ne-tempo-strum-card-solo'}`}
      {...(onClick ? { onClick, title: 'editar el rasgueo de esta parte' } : {})}
    >
      <div className="ne-ts-block ne-ts-tempo">
        <span className="ne-ts-eyebrow">Tempo</span>
        <div className="ne-ts-tempo-row">
          <span className="ne-ts-dot" style={{ animationDuration: `${60000 / bpm}ms` }} />
          <span className="ne-ts-bpm-num">{bpm}</span>
          <span className="ne-ts-bpm-unit">bpm</span>
        </div>
      </div>

      {hasStrum && (
        <>
          <div className="ne-ts-divider" />
          <div className="ne-ts-block ne-ts-strum">
            <span className="ne-ts-eyebrow">Rasgueo</span>
            <div className="ne-ts-cells">
              {strokes.map((s, i) => (
                // Cell + its number travel together as one wrapping unit —
                // two parallel rows wrapping independently risked a cell
                // landing on one line and its own label on the next.
                <span key={i} className="ne-beat-col">
                  <span className={`ne-beat-cell ne-beat-cell-${s.direction}`}>
                    <BeatArrow direction={s.direction} />
                  </span>
                  <span className="ne-beat-label">{i + 1}</span>
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </Wrapper>
  );
}
