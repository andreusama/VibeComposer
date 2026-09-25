import { useRef, useState, useCallback } from 'react';

// Horizontal swipe-between-pages for the bottom-tab-bar home screen
// (MobileHomePager.jsx) — N pages side by side, dragged 1:1 with the
// finger, snapping to whichever page ends up closer than a threshold of
// the viewport width. Tapping a tab jumps directly (see setIndex);
// swiping goes through the same index state so both drive one source of
// truth. Deliberately a plain index pager, not useCabinetSwipe's two-state
// (open/closed) gesture — different shape, not reused.
const SNAP_FRACTION = 0.22; // fraction of viewport width a drag must clear to change page
const START_SLOP = 10;

// Elements that own their own horizontal (or free-drag) touch gesture and
// must never also feed the pager's — otherwise a touch on any of these
// bubbles up to the pager's handlers too, and the whole screen drags along
// underneath whatever the element itself is doing:
//  - .baul-sheet: any open sheet/dialog. The pager swiping the page behind
//    an open sheet makes no sense visually regardless of what's inside it,
//    so this is a blanket "a sheet is open, back off entirely" rule rather
//    than chasing every future scrollable/draggable thing a sheet might add.
//  - .mp-card: a project/album row (ProjectRow.jsx) — swipe-left-to-delete
//    and the long-press-then-drag-to-reorder gesture are both its own.
//  - .res-folder-filter: the horizontally-scrolling folder-chip row on the
//    Recursos screen (native overflow-x scroll, not a custom gesture, but
//    the pager's touch-action:pan-y on an ancestor blocks native horizontal
//    panning for every descendant too — see useSwipePager's own comment).
const NESTED_GESTURE_SELECTOR = '.baul-sheet, .mp-card, .res-folder-filter';

export default function useSwipePager({ count, index, setIndex, width = () => window.innerWidth }) {
  const [dragPx, setDragPx] = useState(null); // px offset from the resting position while a finger is down
  const gestureRef = useRef(null);

  const onTouchStart = useCallback((e) => {
    if (e.target.closest?.(NESTED_GESTURE_SELECTOR)) {
      gestureRef.current = null; // let the nested element own this touch entirely
      return;
    }
    const t = e.touches[0];
    gestureRef.current = { x: t.clientX, y: t.clientY, active: false, dead: false };
  }, []);

  const onTouchMove = useCallback((e) => {
    const g = gestureRef.current;
    if (!g || g.dead) return;
    const t = e.touches[0];
    const dx = t.clientX - g.x;
    const dy = t.clientY - g.y;
    if (!g.active) {
      if (Math.abs(dx) < START_SLOP && Math.abs(dy) < START_SLOP) return;
      if (Math.abs(dy) > Math.abs(dx)) { g.dead = true; return; } // a vertical scroll, not a page swipe
      g.active = true;
    }
    // Can't drag past either end — the pager doesn't wrap.
    const clamped = (index === 0 && dx > 0) || (index === count - 1 && dx < 0) ? dx * 0.35 : dx;
    setDragPx(clamped);
  }, [index, count]);

  const onTouchEnd = useCallback(() => {
    const g = gestureRef.current;
    gestureRef.current = null;
    if (!g?.active || dragPx == null) { setDragPx(null); return; }
    const threshold = width() * SNAP_FRACTION;
    if (dragPx <= -threshold && index < count - 1) setIndex(index + 1);
    else if (dragPx >= threshold && index > 0) setIndex(index - 1);
    setDragPx(null);
  }, [dragPx, index, count, setIndex, width]);

  // Current offset in px, always resolved (settled position when no drag is
  // in progress) — what the pager track's transform should be.
  const offsetPx = -index * width() + (dragPx ?? 0);

  return { offsetPx, dragging: dragPx !== null, handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd } };
}
