// ─── Right-hand strum capture (pure) ───────────────────────────────────────
// The maths behind the strum pad (src/mobile/ChordStrumSheet.jsx): the
// artist performs real up/down swipes with a finger, imitating an actual
// strumming hand, and each discrete swipe becomes one stroke
// { direction, intensity }. Tempo is read off the artist's own timing
// between strokes — nothing is dialled in first.
//
// All of it lives here, away from the touch handlers, because this is the
// part with real judgment in it (what counts as a stroke at all, how hard
// "hard" is, what BPM a burst of swipes implies) and the only part that can
// be verified without a finger on a screen.

// Below this the gesture is a tap, a scroll attempt or an accidental graze,
// not a strum. Deliberately low: a fast flick covers very little distance.
export const STROKE_MIN_PX = 16;

// px/ms. The floor maps to intensity 0 (the softest brush that still reads
// as deliberate), the ceiling to 1 (a full-force stroke). Calibrated to the
// range a thumb actually produces on a phone-sized pad — a gentle stroke
// lands around 0.3 px/ms, a hard one well past 2 px/ms — so the useful part
// of the scale is spread across normal playing instead of being crushed
// into the bottom tenth by one outlier flick.
export const VELOCITY_FLOOR = 0.25;
export const VELOCITY_CEIL = 2.5;

// Anything outside this is not a tempo anyone strums at; see deriveBpm.
export const BPM_MIN = 40;
export const BPM_MAX = 240;

const clamp01 = (n) => Math.max(0, Math.min(1, n));

// Swipe velocity → 0..1. Linear between the floor and the ceiling (not
// eased): the artist is already doing the "feel" curve with their own hand,
// and bending it again here would mean a stroke they performed twice as
// hard doesn't read twice as big, which is the one thing the arrow sizes
// have to tell the truth about. Rounded to 2dp — that is all the precision
// a stored gesture honestly has, and it keeps the jsonb readable.
export function velocityToIntensity(distancePx, durationMs) {
  const dist = Math.abs(distancePx || 0);
  // A zero/sub-ms duration is a timer artefact, not an infinitely fast
  // hand: treat it as 1ms rather than dividing by zero into Infinity.
  const ms = Math.max(1, durationMs || 0);
  const v = dist / ms;
  const scaled = (v - VELOCITY_FLOOR) / (VELOCITY_CEIL - VELOCITY_FLOOR);
  return Math.round(clamp01(scaled) * 100) / 100;
}

// One finished touch on the pad → one stroke, or null when it wasn't a
// stroke at all. `dy` is (endY - startY) in px, so a NEGATIVE dy (finger
// moved up the screen) is an upstroke.
export function classifyStroke(dy, durationMs) {
  const dist = Math.abs(dy || 0);
  if (dist < STROKE_MIN_PX) return null;
  return {
    direction: dy < 0 ? 'up' : 'down',
    intensity: velocityToIntensity(dist, durationMs),
  };
}

// Timestamps (ms, in performance order) of the strokes just recorded → the
// BPM they imply. Average interval rather than the first/last pair, so one
// hesitant gap doesn't define the whole tempo.
//
// Each stroke is counted as one beat, then the result is folded by
// halving/doubling into BPM_MIN..BPM_MAX. The folding matters in practice:
// a strum pattern is almost always played in eighths or sixteenths, so
// stroke-per-beat arithmetic lands at 300+ for perfectly ordinary playing —
// a number that is both unmusical and un-overridable in a sane way. Folding
// reports the tempo the artist would actually name, and they can still
// correct it by hand afterwards (which is the whole reason this is a
// suggestion and not a measurement).
//
// Returns null when there are fewer than two strokes — one stroke carries
// no interval, and guessing a tempo from it would be fabrication.
export function deriveBpm(timestamps) {
  const ts = (timestamps || []).filter((t) => Number.isFinite(t));
  if (ts.length < 2) return null;
  const intervals = [];
  for (let i = 1; i < ts.length; i += 1) {
    const dt = ts[i] - ts[i - 1];
    if (dt > 0) intervals.push(dt);
  }
  if (!intervals.length) return null;
  const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  let bpm = 60000 / avg;
  while (bpm > BPM_MAX) bpm /= 2;
  while (bpm < BPM_MIN) bpm *= 2;
  // Still out of range after folding (a single absurd interval) — clamp
  // rather than return a tempo nothing can play.
  return Math.round(Math.max(BPM_MIN, Math.min(BPM_MAX, bpm)));
}

// Arrow glyph size in px for a stored intensity — the literal "big and
// little arrows" the pattern renders as. min is kept well above zero so the
// softest stroke is still legibly an arrow with a direction, not a dot.
export const ARROW_MIN = 18;
export const ARROW_MAX = 44;

export function arrowSizeFor(intensity, min = ARROW_MIN, max = ARROW_MAX) {
  const i = clamp01(Number.isFinite(intensity) ? intensity : 0);
  return Math.round(min + (max - min) * i);
}

// ms per stroke at a given BPM — drives the visual metronome that steps the
// highlight through the arrows (one stroke = one beat, matching deriveBpm's
// own reading of the gesture, so playback walks the pattern at exactly the
// tempo the strip reports).
export function msPerStroke(bpm) {
  const safe = Math.max(BPM_MIN, Math.min(BPM_MAX, Number(bpm) || 90));
  return 60000 / safe;
}

// Compact human summary of a pattern, for the one-line strip in the note
// editor: "↓↑↓↓" style, no sizes. Kept here rather than inline in the strip
// so the arrow vocabulary has exactly one definition.
export function patternGlyphs(pattern) {
  return (pattern || []).map((s) => (s.direction === 'up' ? '↑' : '↓')).join('');
}
