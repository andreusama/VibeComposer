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

// One already-isolated swipe → one stroke, or null when it wasn't a stroke
// at all. `dy` is (endY - startY) in px, so a NEGATIVE dy (finger moved up
// the screen) is an upstroke. Used both for a single-swipe segment
// (createStrokeSegmenter below) and directly wherever a start/end pair is
// already known.
export function classifyStroke(dy, durationMs) {
  const dist = Math.abs(dy || 0);
  if (dist < STROKE_MIN_PX) return null;
  return {
    direction: dy < 0 ? 'up' : 'down',
    intensity: velocityToIntensity(dist, durationMs),
  };
}

// How far back, in px, a finger has to pull away from a stroke's own
// furthest point before that counts as the START of the NEXT stroke rather
// than a wobble in the one still underway. Smaller than STROKE_MIN_PX on
// purpose: deciding a stroke is happening at all takes real conviction,
// but once one is already underway, it takes less to read "now going the
// other way" — a held note's hand doesn't sit perfectly still.
export const STROKE_REVERSAL_PX = 10;

// A continuous rasgueo gesture, decomposed into strokes as it happens — one
// finger-down, many strokes, no lift between them, the way a real
// strumming hand actually plays (reported 2026-10-09: the one-stroke-per-
// touch model this replaced required lifting and re-touching for every
// single stroke, which is not how anyone strums). Call start() once per
// touch, move() on every touchmove sample, end() on touchend/touchcancel.
//
// move() returns a finished stroke the instant one completes — the finger
// has moved STROKE_MIN_PX in a direction, then pulled back STROKE_REVERSAL_PX
// from however far it got — or null while nothing has finished yet. end()
// always returns something: whatever final partial stroke was in progress,
// or — if nothing in this whole touch ever moved far enough to register as
// a stroke at all — a single MUTE. That last part is deliberate, not a
// fallback: in funk/rumba strumming, a tap of the hand flat against the
// strings to cut them off IS the gesture, not a failed swipe, so a touch
// that never swipes isn't nothing, it's a mute.
//
// Pure and stateful by construction (one instance per live touch, owned by
// the pad component — see ChordStrumSheet.jsx's StrumPad) rather than a
// single do-it-all function, because "is this still the same stroke"
// genuinely depends on everything that happened since start(), not just
// the latest sample.
export function createStrokeSegmenter() {
  let segStart = null; // { y, t } — anchor of the current, uncommitted stroke
  let peak = null; // { y, t } — furthest point reached in segStart's established direction; null until a direction is established
  let struckAnything = false; // true once ANY real stroke has fired this touch — a tap-sized settle AFTER a real stroke is noise, not a mute

  const commit = (to) => {
    const stroke = classifyStroke(to.y - segStart.y, to.t - segStart.t);
    if (stroke) struckAnything = true;
    segStart = to;
    peak = null;
    return stroke;
  };

  return {
    start(y, t) {
      segStart = { y, t };
      peak = null;
      struckAnything = false;
    },
    move(y, t) {
      if (!segStart) return null;
      if (!peak) {
        if (Math.abs(y - segStart.y) >= STROKE_MIN_PX) peak = { y, t };
        return null;
      }
      const dirSign = Math.sign(peak.y - segStart.y);
      const sincePeak = y - peak.y;
      if (Math.sign(sincePeak) === dirSign || sincePeak === 0) {
        // Still extending the same stroke — keep tracking its furthest point.
        if (Math.abs(y - segStart.y) > Math.abs(peak.y - segStart.y)) peak = { y, t };
        return null;
      }
      // Moving back the other way — real reversal, or just a wobble?
      if (Math.abs(sincePeak) < STROKE_REVERSAL_PX) return null;
      const finished = commit(peak);
      // The reversal itself may already reach far enough to establish the
      // NEXT stroke's own direction in this same sample, not the next one.
      if (Math.abs(y - segStart.y) >= STROKE_MIN_PX) peak = { y, t };
      return finished;
    },
    end(y, t) {
      if (!segStart) return null;
      const finished = commit({ y, t });
      const result = finished || (struckAnything ? null : { direction: 'mute', intensity: 0 });
      segStart = null;
      peak = null;
      return result;
    },
    // A cancelled touch (touchcancel) registers nothing at all — not a
    // partial stroke, not a mute. Whatever was in progress just didn't
    // happen.
    cancel() {
      segStart = null;
      peak = null;
      struckAnything = false;
    },
    // Read-only: the in-progress segment's own stroke, for live feedback
    // (StrumPad's own under-the-finger preview) — same classifyStroke a
    // commit would use, just without committing anything.
    preview(y, t) {
      if (!segStart) return null;
      return classifyStroke(y - segStart.y, t - segStart.t);
    },
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
// editor: "↓↑✕↓" style, no sizes. Kept here rather than inline in the strip
// so the arrow vocabulary has exactly one definition.
export function patternGlyphs(pattern) {
  return (pattern || []).map((s) => {
    if (s.direction === 'mute') return '✕';
    return s.direction === 'up' ? '↑' : '↓';
  }).join('');
}
