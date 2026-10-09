import StrumPattern from './StrumPattern.jsx';

// ─── Tempo + Rasgueo header card ────────────────────────────────────────────
// Redesign of the old plain-text ".ne-strum-strip" ("75 BPM ↑ ↓ ↑ ↑", one
// weight, no structure) into two blocks split by a hairline: TEMPO (pulsing
// dot + big serif number) and RASGUEO (StrumPattern.jsx's beat cells, one
// per recorded stroke — size-coded down/up, not the solid/outline coding
// this card used before 2026-10-09). Purely visual — same data this
// already received (strum.bpm / strum.pattern), same tap-to-reopen-the-
// recorder behavior, no new interactivity on the cells themselves.
//
// Reuses .tempo-pulse-dot's own `tempo-pulse-beat` keyframe (TempoPulse.jsx)
// rather than a new animation — same "pulses at the actual rhythm" trick,
// animation-duration = 60000/bpm ms, not a fixed rate.
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
            <StrumPattern pattern={strokes} />
          </div>
        </>
      )}
    </Wrapper>
  );
}
