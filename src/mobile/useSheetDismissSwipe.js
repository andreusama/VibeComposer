import { useRef, useState, useCallback } from 'react';

// Drag-down-to-dismiss for a bottom sheet (.baul-sheet) — the vertical
// sibling of useCabinetSwipe.js's horizontal reveal/put-away gesture, same
// shape on purpose: a gestureRef tracking start point + active/dead state,
// a live offset while the finger is down, a threshold-based decision on
// release. Meant for the sheet's own grabber/header, NOT its scrollable
// body — attaching it there would fight normal list scrolling, so the
// handlers are handed to whatever non-scrolling element the caller puts
// them on (the grabber, a header block), never to the content underneath.
const START_SLOP = 10;     // px of travel before a drag is recognised as one
const CLOSE_FRACTION = 0.28; // how far down (relative to the sheet's own height) counts as "dismiss"

export default function useSheetDismissSwipe({ onClose, enabled = true }) {
  const [translateY, setTranslateY] = useState(0); // 0 = resting; >0 while a drag is live — RENDER ONLY
  const gestureRef = useRef(null);
  const heightRef = useRef(0);
  // The live dy, read synchronously by onTouchEnd. React state alone isn't
  // safe here: a real swipe fires touchmove then touchend in quick
  // succession, often within the same tick, and onTouchEnd's own closure
  // over `translateY` can still be bound to the PREVIOUS render — the same
  // stale-closure class of bug already hit (and fixed with a ref) in this
  // session's drag-and-drop work, caught here the same way: a harness test
  // dispatching a real touchmove->touchend sequence back to back, which
  // silently read translateY=0 and never closed until this was a ref.
  const liveDyRef = useRef(0);

  const onTouchStart = useCallback((e) => {
    if (!enabled) { gestureRef.current = null; return; }
    const t = e.touches[0];
    const sheetEl = e.currentTarget.closest('.baul-sheet');
    gestureRef.current = { x: t.clientX, y: t.clientY, active: false, dead: false, sheetEl };
  }, [enabled]);

  const onTouchMove = useCallback((e) => {
    const g = gestureRef.current;
    if (!g || g.dead) return;
    const t = e.touches[0];
    const dx = t.clientX - g.x;
    const dy = t.clientY - g.y;
    if (!g.active) {
      // Only a genuinely downward drag counts — sideways travel (e.g. the
      // folder-filter row's own horizontal scroll, if the header is ever
      // used as a drag target) or an upward flick is left alone entirely.
      if (dy <= START_SLOP || Math.abs(dx) > Math.abs(dy)) {
        if (Math.abs(dx) > START_SLOP || dy < -START_SLOP) g.dead = true;
        return;
      }
      g.active = true;
      heightRef.current = g.sheetEl?.getBoundingClientRect().height || window.innerHeight;
    }
    const next = Math.max(0, dy);
    liveDyRef.current = next;
    setTranslateY(next);
  }, []);

  const onTouchEnd = useCallback(() => {
    const g = gestureRef.current;
    gestureRef.current = null;
    if (g?.active && liveDyRef.current > heightRef.current * CLOSE_FRACTION) onClose();
    liveDyRef.current = 0;
    setTranslateY(0);
  }, [onClose]);

  return { translateY, handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd } };
}
