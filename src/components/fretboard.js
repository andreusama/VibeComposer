// All measurements in px
const W          = 160;
const PAD        = 22;
const FRET_H     = 36;
const NUT_Y      = 44;
const NUM_FRETS  = 4;
const STRING_W   = (W - PAD * 2) / 3;
const STRINGS    = ['G', 'C', 'E', 'A'];

/**
 * Generates an SVG string for a ukulele chord diagram.
 * @param {number[]} frets  [G-string, C-string, E-string, A-string]
 *   0 = open, -1 = muted, 1+ = fret number
 * @returns {string} Raw SVG markup
 */
export function fretboardSVG(rawFrets, accent = '#d4845a') {
  // -1 is the only meaningful value below zero (muted string). Anything
  // lower has no meaning and used to place a dot above the nut, outside the
  // diagram entirely — clamp defensively here too, not just at the input,
  // so any already-stored bad value (typed before this existed) still
  // renders sanely instead of drawing off the fretboard.
  const frets = rawFrets.map((f) => Math.max(-1, f));
  const nonZero   = frets.filter((f) => f > 0);
  const maxFret   = nonZero.length ? Math.max(...nonZero) : 0;
  const startFret = maxFret > NUM_FRETS ? maxFret - NUM_FRETS + 1 : 1;
  const isAtNut   = startFret === 1;
  const nutH      = isAtNut ? 5 : 2;
  const totalH    = NUT_Y + nutH + FRET_H * NUM_FRETS + 28;

  const dotCy = (fret) => NUT_Y + nutH + FRET_H * (fret - startFret + 0.5);

  const fretLines = Array.from({ length: NUM_FRETS }, (_, i) => {
    const y = NUT_Y + nutH + FRET_H * (i + 1);
    return `<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="#d0c8bc" stroke-width="1"/>`;
  }).join('');

  const stringLines = STRINGS.map((_, i) => {
    const x  = PAD + STRING_W * i;
    const sw = i === 0 ? 1.8 : 1;
    return `<line x1="${x}" y1="${NUT_Y}" x2="${x}" y2="${NUT_Y + nutH + FRET_H * NUM_FRETS}" stroke="#a09080" stroke-width="${sw}"/>`;
  }).join('');

  const markers = frets.map((f, i) => {
    const cx = PAD + STRING_W * i;

    if (f === -1) return `<text x="${cx}" y="${NUT_Y - 10}" text-anchor="middle" fill="#8b7a6a" font-size="15" font-family="monospace">×</text>`;

    if (f === 0)  return `<circle cx="${cx}" cy="${NUT_Y - 13}" r="7" fill="none" stroke="${accent}" stroke-width="2"/>`;

    const cy = dotCy(f);
    return `
      <circle cx="${cx}" cy="${cy}" r="12" fill="${accent}"/>
      <text x="${cx}" y="${cy + 5}" text-anchor="middle" fill="#faf7f2" font-size="12" font-weight="bold" font-family="monospace">${f}</text>
    `;
  }).join('');

  const stringLabels = STRINGS.map((s, i) =>
    `<text x="${PAD + STRING_W * i}" y="${totalH - 4}" text-anchor="middle" fill="#8b7a6a" font-size="10" font-family="monospace">${s}</text>`
  ).join('');

  // When the chord is fretted high enough that frets 1-4 wouldn't fit
  // everything, the diagram window slides up the neck (startFret > 1) — a
  // labeled chip pinned to the left, not a sliver of gray text, so it reads
  // immediately as "this diagram starts at fret N" rather than looking like
  // a diagram that's merely missing its low frets.
  const fretIndicator = !isAtNut
    ? `<g>
        <rect x="${PAD - 36}" y="${NUT_Y + nutH + FRET_H * 0.5 - 10}" width="28" height="20" rx="5" fill="#EEF0FC" stroke="#C7CCF2" stroke-width="1"/>
        <text x="${PAD - 22}" y="${NUT_Y + nutH + FRET_H * 0.5 + 4}" text-anchor="middle" fill="#4552D6" font-size="11" font-weight="bold" font-family="monospace">${startFret}fr</text>
      </g>`
    : '';

  const leftMargin = isAtNut ? 0 : 20;

  return `
    <svg width="${W + leftMargin}" height="${totalH}" viewBox="${-leftMargin} 0 ${W + leftMargin} ${totalH}" style="display:block">
      <rect x="${PAD}" y="${NUT_Y}" width="${W - PAD * 2}" height="${nutH}" fill="${isAtNut ? '#c8b89a' : '#444'}" rx="1"/>
      ${fretLines}
      ${stringLines}
      ${markers}
      ${stringLabels}
      ${fretIndicator}
    </svg>
  `;
}
