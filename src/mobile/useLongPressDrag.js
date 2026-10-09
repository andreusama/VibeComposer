import { useCallback, useEffect, useRef, useState } from 'react';

// ─── "hold this thing, then drag it onto a line" — the origin gesture ──────
// Shared by every chip/row that can be picked up and dropped onto a lyric
// line (ChordStrumSheet's ChordChip, ResourcePickerSheet's
// ResourcePickerRow): hold past LONG_PRESS_MS without moving more than
// LONG_PRESS_SLOP and it's a drag-start; move past the slop first, or
// release before the timer, and it isn't. Both call sites had grown their
// own identical copy of this timer/slop bookkeeping (2026-10-08); pulled
// out here so there is exactly one place that owns "how long is a
// long-press", not two that have to be kept in sync by hand.
//
// Deliberately imperative (start/move/end), not a ready-made set of touch
// handlers: a plain chip (ChordChip) wires those three straight to its own
// onTouchStart/Move/End, but a row that ALSO tracks its own gesture on the
// same finger (ResourcePickerRow's swipe-to-reveal) needs to run its own
// logic in the same handler, from the same touch point — which a hook that
// insisted on owning the whole event wouldn't allow. `move` returning
// whether THIS call is the one that crossed the slop (not just "is it past
// it") is specifically for that caller: it's the same instant a swipe
// caller decides "this is a swipe now, not a tap", so returning it instead
// of leaving the caller to separately track "did I already notice" avoids
// a second copy of that edge once more.
//
// Ownership of what happens AFTER the drag starts (the live drag position,
// the document-level move/end listeners, hover/drop resolution) belongs to
// useLineDragDrop.js, not here — this hook's job ends the moment
// onDragStart fires, same as the chip/row components it replaced always
// intended (see each one's own historical comment on why the drag was
// handed off rather than tracked locally).
export default function useLongPressDrag({ ms = 380, slop = 8, vibrate = 12, onDragStart }) {
  const [pressed, setPressed] = useState(false);
  const startRef = useRef({ x: 0, y: 0, moved: false });
  const timerRef = useRef(null);

  const clearTimer = useCallback(() => { clearTimeout(timerRef.current); timerRef.current = null; }, []);
  useEffect(() => clearTimer, [clearTimer]);

  const start = useCallback((x, y, payload) => {
    startRef.current = { x, y, moved: false };
    setPressed(true);
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      startRef.current.moved = true; // whatever follows is never a tap
      setPressed(false);
      if (vibrate) navigator.vibrate?.(vibrate);
      onDragStart(payload, x, y);
    }, ms);
  }, [ms, vibrate, onDragStart, clearTimer]);

  // Returns true exactly on the call that first crosses the slop — the
  // "this just became a swipe/drag, not a tap" edge a caller tracking its
  // own gesture (ResourcePickerRow's reveal) needs once, not "is it past
  // the slop" on every subsequent call.
  const move = useCallback((x, y) => {
    if (!timerRef.current) return false;
    if (Math.hypot(x - startRef.current.x, y - startRef.current.y) <= slop) return false;
    clearTimer();
    setPressed(false);
    return true;
  }, [slop, clearTimer]);

  const end = useCallback(() => { clearTimer(); setPressed(false); }, [clearTimer]);

  return {
    pressed,
    start,
    move,
    end,
    cancel: end,
    moved: () => startRef.current.moved,
    startPoint: () => ({ x: startRef.current.x, y: startRef.current.y }),
  };
}
