import { describe, it, expect } from 'vitest';
import {
  velocityToIntensity, classifyStroke, deriveBpm, arrowSizeFor, msPerStroke, patternGlyphs,
  createStrokeSegmenter,
  STROKE_MIN_PX, STROKE_REVERSAL_PX, VELOCITY_FLOOR, VELOCITY_CEIL, BPM_MIN, BPM_MAX, ARROW_MIN, ARROW_MAX,
} from './strum.js';

describe('velocityToIntensity', () => {
  it('maps the floor velocity to 0 and the ceiling to 1', () => {
    expect(velocityToIntensity(VELOCITY_FLOOR * 100, 100)).toBe(0);
    expect(velocityToIntensity(VELOCITY_CEIL * 100, 100)).toBe(1);
  });

  it('is linear in between', () => {
    const mid = (VELOCITY_FLOOR + VELOCITY_CEIL) / 2;
    expect(velocityToIntensity(mid * 100, 100)).toBeCloseTo(0.5, 2);
  });

  it('clamps rather than going negative or past 1', () => {
    expect(velocityToIntensity(1, 1000)).toBe(0);   // crawling
    expect(velocityToIntensity(500, 20)).toBe(1);   // absurdly fast
  });

  it('reads a harder swipe as a higher intensity at the same distance', () => {
    const soft = velocityToIntensity(120, 400);
    const hard = velocityToIntensity(120, 80);
    expect(hard).toBeGreaterThan(soft);
  });

  it('uses the absolute distance, so an upstroke is not negative-intensity', () => {
    expect(velocityToIntensity(-120, 100)).toBe(velocityToIntensity(120, 100));
  });

  it('treats a zero/sub-millisecond duration as 1ms instead of dividing by zero', () => {
    expect(velocityToIntensity(100, 0)).toBe(1);
    expect(Number.isFinite(velocityToIntensity(100, 0))).toBe(true);
  });

  it('rounds to two decimals', () => {
    const v = velocityToIntensity(137, 211);
    expect(v).toBe(Math.round(v * 100) / 100);
  });
});

describe('classifyStroke', () => {
  it('reads a downward displacement as a downstroke', () => {
    expect(classifyStroke(90, 120).direction).toBe('down');
  });

  it('reads an upward (negative) displacement as an upstroke', () => {
    expect(classifyStroke(-90, 120).direction).toBe('up');
  });

  it('rejects a gesture shorter than the stroke minimum', () => {
    expect(classifyStroke(STROKE_MIN_PX - 1, 100)).toBeNull();
    expect(classifyStroke(0, 100)).toBeNull();
    expect(classifyStroke(-(STROKE_MIN_PX - 1), 100)).toBeNull();
  });

  it('accepts a gesture exactly at the minimum', () => {
    expect(classifyStroke(STROKE_MIN_PX, 100)).not.toBeNull();
  });

  it('carries the velocity-derived intensity through', () => {
    expect(classifyStroke(-200, 80)).toEqual({ direction: 'up', intensity: velocityToIntensity(200, 80) });
  });

  it('is defensive about missing input', () => {
    expect(classifyStroke(undefined, undefined)).toBeNull();
  });
});

describe('deriveBpm', () => {
  it('derives BPM from the average interval between strokes', () => {
    // 500ms apart = 120 beats per minute
    expect(deriveBpm([0, 500, 1000, 1500])).toBe(120);
  });

  it('averages rather than trusting the first pair', () => {
    // intervals 400, 600 -> avg 500 -> 120
    expect(deriveBpm([0, 400, 1000])).toBe(120);
  });

  it('folds an eighth-note strum into a nameable tempo instead of reporting 300+', () => {
    // 200ms apart would be 300 "bpm" counted per stroke; halved -> 150
    expect(deriveBpm([0, 200, 400, 600])).toBe(150);
    const bpm = deriveBpm([0, 120, 240, 360, 480]);
    expect(bpm).toBeGreaterThanOrEqual(BPM_MIN);
    expect(bpm).toBeLessThanOrEqual(BPM_MAX);
  });

  it('doubles a very slow reading up into range', () => {
    // 3000ms apart = 20bpm -> doubled -> 40
    expect(deriveBpm([0, 3000])).toBe(40);
  });

  it('always lands inside the musical range', () => {
    for (const gap of [40, 90, 150, 333, 700, 1200, 5000, 20000]) {
      const bpm = deriveBpm([0, gap, gap * 2, gap * 3]);
      expect(bpm).toBeGreaterThanOrEqual(BPM_MIN);
      expect(bpm).toBeLessThanOrEqual(BPM_MAX);
    }
  });

  it('returns null when there is no interval to read a tempo from', () => {
    expect(deriveBpm([])).toBeNull();
    expect(deriveBpm([1000])).toBeNull();
    expect(deriveBpm(null)).toBeNull();
    expect(deriveBpm([1000, 1000])).toBeNull(); // two strokes, zero elapsed
  });

  it('ignores non-finite timestamps instead of producing NaN', () => {
    expect(deriveBpm([0, NaN, 500, undefined, 1000])).toBe(120);
  });
});

describe('arrowSizeFor', () => {
  it('scales the glyph between the min and max size', () => {
    expect(arrowSizeFor(0)).toBe(ARROW_MIN);
    expect(arrowSizeFor(1)).toBe(ARROW_MAX);
    expect(arrowSizeFor(0.5)).toBe(Math.round((ARROW_MIN + ARROW_MAX) / 2));
  });

  it('is monotonic — a harder stroke is never drawn smaller', () => {
    let prev = 0;
    for (const i of [0, 0.1, 0.25, 0.4, 0.5, 0.75, 0.9, 1]) {
      const size = arrowSizeFor(i);
      expect(size).toBeGreaterThanOrEqual(prev);
      prev = size;
    }
  });

  it('keeps the softest stroke legibly an arrow, not a dot', () => {
    expect(arrowSizeFor(0)).toBeGreaterThan(12);
  });

  it('clamps garbage input into range', () => {
    expect(arrowSizeFor(-3)).toBe(ARROW_MIN);
    expect(arrowSizeFor(42)).toBe(ARROW_MAX);
    expect(arrowSizeFor(undefined)).toBe(ARROW_MIN);
  });

  it('respects a caller-supplied size range (the compact editor strip)', () => {
    expect(arrowSizeFor(0, 10, 20)).toBe(10);
    expect(arrowSizeFor(1, 10, 20)).toBe(20);
  });
});

describe('msPerStroke', () => {
  it('converts BPM to a per-stroke interval', () => {
    expect(msPerStroke(120)).toBe(500);
    expect(msPerStroke(60)).toBe(1000);
  });

  it('clamps an out-of-range or garbage BPM instead of returning 0/Infinity', () => {
    expect(msPerStroke(0)).toBe(60000 / 90);       // falls back to the default tempo
    expect(msPerStroke(9999)).toBe(60000 / BPM_MAX);
    expect(msPerStroke(1)).toBe(60000 / BPM_MIN);
    expect(Number.isFinite(msPerStroke(null))).toBe(true);
  });
});

describe('patternGlyphs', () => {
  it('renders a pattern as a compact arrow string', () => {
    expect(patternGlyphs([
      { direction: 'down', intensity: 1 },
      { direction: 'up', intensity: 0.2 },
      { direction: 'down', intensity: 0.6 },
    ])).toBe('↓↑↓');
  });

  it('renders a mute as its own glyph, not an arrow', () => {
    expect(patternGlyphs([{ direction: 'down' }, { direction: 'mute' }, { direction: 'up' }])).toBe('↓✕↑');
  });

  it('handles an empty or missing pattern', () => {
    expect(patternGlyphs([])).toBe('');
    expect(patternGlyphs(null)).toBe('');
  });
});

describe('createStrokeSegmenter', () => {
  it('commits nothing mid-gesture for a single unbroken swipe — only on end()', () => {
    const seg = createStrokeSegmenter();
    seg.start(0, 0);
    expect(seg.move(20, 50)).toBeNull(); // establishing direction, no reversal yet
    expect(seg.move(30, 90)).toBeNull(); // still extending the same stroke
    const final = seg.end(35, 110);
    expect(final).toEqual({ direction: 'down', intensity: velocityToIntensity(35, 110) });
  });

  it('reads an upward swipe the same way, sign flipped', () => {
    const seg = createStrokeSegmenter();
    seg.start(100, 0);
    const final = seg.end(40, 100);
    expect(final.direction).toBe('up');
  });

  it('commits a stroke mid-gesture the instant the finger reverses, without a lift', () => {
    const seg = createStrokeSegmenter();
    seg.start(0, 0);
    seg.move(30, 50); // establish the downstroke
    // Reverses past STROKE_REVERSAL_PX without ever releasing the touch.
    const firstStroke = seg.move(5, 100);
    expect(firstStroke).toEqual({ direction: 'down', intensity: velocityToIntensity(30, 50) });
  });

  it('keeps decomposing a continuous zigzag into one stroke per direction change', () => {
    const seg = createStrokeSegmenter();
    const strokes = [];
    seg.start(0, 0);
    const commit = (y, t) => { const s = seg.move(y, t); if (s) strokes.push(s.direction); };
    commit(30, 50);   // extending stroke 1 (down)
    commit(5, 100);   // reverses past threshold -> stroke 1 commits (down), stroke 2 (up) begins
    commit(-25, 150); // extending stroke 2 (up)
    commit(10, 200);  // reverses -> stroke 2 commits (up), stroke 3 (down) begins
    const last = seg.end(40, 250); // stroke 3 finishes on release
    if (last) strokes.push(last.direction);
    expect(strokes).toEqual(['down', 'up', 'down']);
  });

  it('ignores a reversal smaller than STROKE_REVERSAL_PX as noise in the same stroke', () => {
    const seg = createStrokeSegmenter();
    seg.start(0, 0);
    seg.move(30, 50); // peak at 30
    expect(seg.move(30 - (STROKE_REVERSAL_PX - 1), 60)).toBeNull(); // too small a pullback to be a new stroke
    const final = seg.end(40, 100); // still extends the SAME stroke, now from 0 to 40
    expect(final).toEqual({ direction: 'down', intensity: velocityToIntensity(40, 100) });
  });

  it('resolves a pure tap (never crosses STROKE_MIN_PX) into a mute on release', () => {
    const seg = createStrokeSegmenter();
    seg.start(0, 0);
    expect(seg.move(3, 20)).toBeNull();
    expect(seg.end(5, 40)).toEqual({ direction: 'mute', intensity: 0 });
  });

  it('resolves a tap with no move() calls at all into a mute', () => {
    const seg = createStrokeSegmenter();
    seg.start(0, 0);
    expect(seg.end(1, 30)).toEqual({ direction: 'mute', intensity: 0 });
  });

  it('does NOT register a mute for a tiny settle right after a real stroke in the same touch', () => {
    const seg = createStrokeSegmenter();
    seg.start(0, 0);
    seg.move(30, 50); // establishes the downstroke, peak at 30
    // Pulls back 12px (past REVERSAL_PX, under STROKE_MIN_PX) — commits the
    // downstroke, but 12px isn't enough to establish a SECOND stroke's own
    // direction yet, so the new segment starts with no peak of its own.
    const first = seg.move(18, 90);
    expect(first).toEqual({ direction: 'down', intensity: velocityToIntensity(30, 50) });
    // Releases only 10px further from the new segment's own start (30) —
    // under STROKE_MIN_PX, so this settle is neither a second stroke nor
    // (since a real stroke already fired this touch) a mute.
    expect(seg.end(20, 110)).toBeNull();
  });

  it('cancel() discards the in-progress gesture entirely — no stroke, no mute', () => {
    const seg = createStrokeSegmenter();
    seg.start(0, 0);
    seg.move(30, 50);
    seg.cancel();
    expect(seg.end(40, 100)).toBeNull(); // nothing to end, start() was never called again
  });

  it('preview() reflects the in-progress segment without committing it', () => {
    const seg = createStrokeSegmenter();
    seg.start(0, 0);
    seg.move(10, 50); // below STROKE_MIN_PX, no direction established yet
    expect(seg.preview(10, 50)).toBeNull();
    seg.move(20, 80); // establishes the stroke
    expect(seg.preview(25, 90)).toEqual({ direction: 'down', intensity: velocityToIntensity(25, 90) });
  });

  it('returns null for every method before start() has been called', () => {
    const seg = createStrokeSegmenter();
    expect(seg.move(10, 10)).toBeNull();
    expect(seg.end(10, 10)).toBeNull();
    expect(seg.preview(10, 10)).toBeNull();
  });
});
