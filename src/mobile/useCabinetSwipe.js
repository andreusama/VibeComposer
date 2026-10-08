import { useRef, useState, useCallback } from 'react';

// Horizontal-swipe state for a pane that slides in from the LEFT of the
// screen (the Baúl's glass cabinet). Two uses of the same gesture: swipe
// right on the main screen to reveal it, swipe left on the pane to put it
// away. `revealed` is how many px of the pane are showing right now while a
// finger is dragging it (null when no drag is in progress — the caller then
// uses its own resting position, so CSS can animate the settle).
//
// The pane deliberately ignores touches that start in the leftmost EDGE px:
// Android's system back gesture (and iOS's swipe-back) live there, and
// fighting them makes both feel broken. A mostly-vertical gesture is handed
// back to the page scroll for good the moment it's recognised as one.
const EDGE = 24;          // px kept free for the system back gesture
const START_SLOP = 12;    // px of travel before a swipe is recognised
const OPEN_FRACTION = 0.3; // how far it has to be pulled to count as opened

export default function useCabinetSwipe({ open, setOpen, width = () => window.innerWidth }) {
  const [revealed, setRevealed] = useState(null);
  const gestureRef = useRef(null);
  const revealedRef = useRef(0);

  const onTouchStart = useCallback((e) => {
    const t = e.touches[0];
    if (!open && t.clientX < EDGE) { gestureRef.current = null; return; }
    gestureRef.current = { x: t.clientX, y: t.clientY, active: false, dead: false };
  }, [open]);

  const onTouchMove = useCallback((e) => {
    const g = gestureRef.current;
    if (!g || g.dead) return;
    const t = e.touches[0];
    const dx = t.clientX - g.x;
    const dy = t.clientY - g.y;
    if (!g.active) {
      if (Math.abs(dy) > START_SLOP && Math.abs(dy) > Math.abs(dx)) { g.dead = true; return; } // a scroll
      const rightwardOpen = !open && dx > START_SLOP;
      const leftwardClose = open && dx < -START_SLOP;
      if (!(rightwardOpen || leftwardClose) || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      g.active = true;
    }
    const w = width();
    const next = Math.max(0, Math.min(w, (open ? w : 0) + dx));
    revealedRef.current = next;
    setRevealed(next);
  }, [open, width]);

  const onTouchEnd = useCallback(() => {
    const g = gestureRef.current;
    gestureRef.current = null;
    if (!g?.active) return;
    const w = width();
    // Closing needs the same pull distance as opening, measured from the
    // other end — a small nudge either way springs back.
    setOpen(open ? revealedRef.current > w * (1 - OPEN_FRACTION) : revealedRef.current > w * OPEN_FRACTION);
    setRevealed(null);
  }, [open, setOpen, width]);

  return { revealed, handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd } };
}
