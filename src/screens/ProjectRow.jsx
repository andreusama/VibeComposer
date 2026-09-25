import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { computePreviewLayout } from './projectsData.js';
import { IcChevronRight } from '../mobile/icons.jsx';

// "editado hoy" for anything from the last 24h of calendar days, otherwise a
// plain lowercase date.
export function formatEdited(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return 'editado hoy';
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).toLowerCase();
}

export function ProjectThumbnail({ nodes, links }) {
  const { points, lines } = useMemo(() => computePreviewLayout(nodes || [], links || []), [nodes, links]);
  return (
    <div className="mp-thumb">
      {points.length > 0 && (
        <svg className="mp-thumb-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          {lines.map((l, i) => <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />)}
          {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="4" />)}
        </svg>
      )}
    </div>
  );
}

const REVEAL = 84; // px of the delete action revealed on a full swipe-left
const LONG_PRESS_MS = 380; // hold this long without moving to pick the card up
const LONG_PRESS_SLOP = 8; // px of finger travel that still counts as "holding"

// While a card is lifted, holding it near the top/bottom of the list scrolls
// the list, faster the closer to (or past) the edge. The bottom zone is
// configurable because the album screen has a drop zone down there: scrolling
// must stop short of it (edgeBottomDead), otherwise the only way to scroll a
// long album down is to hold the finger over "take it out of the album".
const EDGE_TOP = 130;            // sticky header height + a little
const EDGE_BOTTOM_DEFAULT = 110; // tab bar / FAB clearance
const EDGE_RAMP = 60;            // px over which speed ramps from 0 to max
const MAX_SCROLL_PER_FRAME = 14;

// Which drop target (a `data-drop-id` element) is under a screen point. The
// dragged card is pointer-events:none while lifted, so it never hides what's
// under it.
export function dropIdAt(x, y) {
  return document.elementFromPoint(x, y)?.closest('[data-drop-id]')?.dataset.dropId ?? null;
}

// The measured rectangles of every row currently on screen, in the shape
// reorder.js's dropIntentAt expects.
export function readRowRects() {
  return [...document.querySelectorAll('[data-row-id]')].map((el) => {
    const { top, bottom } = el.getBoundingClientRect();
    return { id: el.dataset.rowId, kind: el.dataset.rowKind, top, bottom };
  });
}

// Each project is its own elevated card (white on the deeper screen ground,
// with BOTH a shadow and a 1.5px border — two independent contrast cues, see
// .mp-card in style.css). The card also slides left to reveal "Eliminar".
// Generic over what it shows (a single/track or an album): the caller passes
// the thumbnail, title and meta line, this only owns the swipe/press chrome.
//
// Drag & drop (touch): passing `onDragEnd` makes the row draggable — press and
// hold, then move. While lifted, onDragMove(x, y, scrolled) fires every frame
// (the list can be scrolling under a still finger, so the drop target changes
// without the finger moving); releasing calls onDragEnd(x, y, scrolled)
// (null, null if the system cancelled the touch). `scrolled` is how far the
// list has autoscrolled since the drag began — the caller should measure
// every row's rect once (readRowRects, at drag-start) and offset by
// `scrolled` on each move, rather than re-measuring the whole list from the
// DOM every frame. `rowId`/`rowKind` make the row measurable for drop
// hit-testing; `dropReady` / `dropActive` / `insertMark` are its visuals for
// "a drag is in progress" / "will be filed inside me" / "will land
// before|after me".
export default function ProjectRow({
  thumb, title, meta, onOpen, onDelete,
  rowId, rowKind, dropReady, dropActive, insertMark, edgeBottom = EDGE_BOTTOM_DEFAULT, edgeBottomDead = 0,
  onDragStart, onDragMove, onDragEnd,
}) {
  const [offset, setOffset] = useState(0);
  const [pressed, setPressed] = useState(false);
  const [drag, setDrag] = useState(null); // { dx, dy } while lifted
  const startRef = useRef({ x: 0, y: 0, base: 0, moved: false });
  const draggingRef = useRef(false);
  const pressTimerRef = useRef(null);
  const cardRef = useRef(null);
  const pointRef = useRef({ x: 0, y: 0 });   // latest finger position
  const scrollerRef = useRef(null);
  const scrollStartRef = useRef(0);
  const scrolledRef = useRef(0); // latest autoscroll delta this drag, for onDragEnd's last report
  const rafRef = useRef(0);
  const draggable = !!onDragEnd;

  // Latest props for the native listener / frame loop below (set up once).
  const cbRef = useRef({});
  cbRef.current = { onDragStart, onDragMove, onDragEnd, edgeBottom, edgeBottomDead };

  const clearPressTimer = () => { clearTimeout(pressTimerRef.current); pressTimerRef.current = null; };
  const stopLoop = () => { cancelAnimationFrame(rafRef.current); rafRef.current = 0; };
  useEffect(() => () => { clearPressTimer(); stopLoop(); }, []);

  // One frame of a drag: autoscroll if the finger is near an edge, then place
  // the card under the finger — compensating for however far the list has
  // scrolled since the drag began, since the card lives inside the scrolling
  // content — and tell the parent where the finger is now.
  const tick = useCallback(() => {
    const scroller = scrollerRef.current;
    const { x, y } = pointRef.current;
    if (scroller) {
      const rect = scroller.getBoundingClientRect();
      const topEdge = rect.top + EDGE_TOP;
      const bottomEdge = rect.bottom - cbRef.current.edgeBottom;
      const bottomDead = rect.bottom - cbRef.current.edgeBottomDead; // no scrolling below this line
      let speed = 0;
      if (y < topEdge) speed = -Math.min(1, (topEdge - y) / EDGE_RAMP) * MAX_SCROLL_PER_FRAME;
      else if (y > bottomEdge && y <= bottomDead) speed = Math.min(1, (y - bottomEdge) / EDGE_RAMP) * MAX_SCROLL_PER_FRAME;
      if (speed) scroller.scrollTop += speed;
    }
    const scrolled = scroller ? scroller.scrollTop - scrollStartRef.current : 0;
    scrolledRef.current = scrolled;
    setDrag({ dx: x - startRef.current.x, dy: y - startRef.current.y + scrolled });
    // Passing `scrolled` lets the caller keep a single measurement of every
    // row's rect from drag-start and cheaply offset it, instead of
    // re-querying + re-measuring the whole list from the DOM every frame.
    cbRef.current.onDragMove?.(x, y, scrolled);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  // React's onTouchMove is passive, so it can't stop the page from scrolling
  // under a drag — that needs a native, non-passive listener. It only records
  // where the finger is; the frame loop does the rest.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return undefined;
    const handler = (e) => {
      if (!draggingRef.current) return;
      e.preventDefault();
      const t = e.touches[0];
      pointRef.current = { x: t.clientX, y: t.clientY };
    };
    el.addEventListener('touchmove', handler, { passive: false });
    return () => el.removeEventListener('touchmove', handler);
  }, []);

  const onTouchStart = useCallback((e) => {
    const t = e.touches[0];
    startRef.current = { x: t.clientX, y: t.clientY, base: offset, moved: false };
    setPressed(true);
    if (!draggable) return;
    clearPressTimer();
    pressTimerRef.current = setTimeout(() => {
      pressTimerRef.current = null;
      draggingRef.current = true;
      startRef.current.moved = true; // whatever follows is never a tap
      pointRef.current = { x: startRef.current.x, y: startRef.current.y };
      scrollerRef.current = cardRef.current?.closest('.mp-body') || null;
      scrollStartRef.current = scrollerRef.current ? scrollerRef.current.scrollTop : 0;
      scrolledRef.current = 0;
      setOffset(0);
      setPressed(false);
      setDrag({ dx: 0, dy: 0 });
      navigator.vibrate?.(12);
      cbRef.current.onDragStart?.();
      rafRef.current = requestAnimationFrame(tick);
    }, LONG_PRESS_MS);
  }, [offset, draggable, tick]);

  const onTouchMove = useCallback((e) => {
    if (draggingRef.current) return; // the native listener owns a drag
    const t = e.touches[0];
    const dx = t.clientX - startRef.current.x;
    const dy = t.clientY - startRef.current.y;
    if (Math.hypot(dx, dy) > LONG_PRESS_SLOP) clearPressTimer(); // moving, not holding
    if (Math.abs(dx) > 6) { startRef.current.moved = true; setPressed(false); } // a swipe, not a press
    setOffset(Math.max(-REVEAL, Math.min(0, startRef.current.base + dx)));
  }, []);

  const finishDrag = useCallback((x, y) => {
    draggingRef.current = false;
    stopLoop();
    // Report before clearing state so the drop point is hit-tested while the
    // card is still pointer-events:none.
    cbRef.current.onDragEnd?.(x, y, scrolledRef.current);
    setDrag(null);
  }, []);

  const onTouchEnd = useCallback((e) => {
    clearPressTimer();
    setPressed(false);
    if (draggingRef.current) {
      const t = e.changedTouches[0];
      finishDrag(t.clientX, t.clientY);
      return;
    }
    setOffset((o) => (o < -REVEAL / 2 ? -REVEAL : 0));
  }, [finishDrag]);

  const onTouchCancel = useCallback(() => {
    clearPressTimer();
    setPressed(false);
    if (draggingRef.current) finishDrag(null, null);
  }, [finishDrag]);

  const handleOpen = () => {
    if (startRef.current.moved) return;      // it was a swipe or a drag, not a tap
    if (offset !== 0) { setOffset(0); return; } // first tap closes the revealed action
    onOpen();
  };

  const cardClass = `mp-card${pressed ? ' pressed' : ''}${drag ? ' dragging' : ''}${dropReady ? ' drop-ready' : ''}${dropActive ? ' drop-active' : ''}${insertMark ? ` mark-${insertMark}` : ''}`;

  return (
    <div
      ref={cardRef}
      className={cardClass}
      data-row-id={rowId}
      data-row-kind={rowKind}
      style={drag ? { transform: `translate(${drag.dx}px, ${drag.dy}px) scale(1.03)` } : undefined}
    >
      <button className="mp-row-delete-action" onClick={onDelete}>Eliminar</button>
      <div
        className="mp-row"
        role="button"
        tabIndex={0}
        style={{ transform: `translateX(${offset}px)` }}
        onClick={handleOpen}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
        onMouseDown={() => setPressed(true)}
        onMouseUp={() => setPressed(false)}
        onMouseLeave={() => setPressed(false)}
      >
        {thumb}
        <div className="mp-row-body">
          <div className="mp-row-title">{title || 'Sin título'}</div>
          <div className="mp-row-meta">{meta}</div>
        </div>
        <span className="mp-row-chevron" aria-hidden="true"><IcChevronRight size={15} /></span>
      </div>
    </div>
  );
}

