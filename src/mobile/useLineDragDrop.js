import { useCallback, useEffect, useRef, useState } from 'react';
import { lineIndexFromPoint, effectiveDragPoint } from '../utils/lineHitTest.js';

// ─── "carry a picked-up thing across the screen, onto a line" ──────────────
// The live half of a long-press-and-drag-onto-a-line gesture, picked up
// once useLongPressDrag.js's onDragStart fires. ChordStrumSheet and
// ResourcePickerSheet each grew their own copy of this — same drag/dragRef
// state, same document-level touchmove/touchend/touchcancel listeners, same
// reasoning in each one's own comment for why the listeners live on the
// SHEET (the one thing in the tree guaranteed to outlive the gesture) and
// not on whatever chip/row started it (which unmounts the instant the drag
// begins, when the sheet shrinks to a strip — reported 2026-10-08 as "drag
// picks up, then the sheet just freezes").
//
// That duplication is exactly how the scrim pointer-events bug (fixed
// 2026-10-09 in style.css's .res-picker-scrim-dragging) stayed invisible
// for one picker and not the other for a while: two copies of the same
// state machine is two places a fix has to be remembered. One hook, used by
// both, means it only has to be fixed once — and the next picker that wants
// "pick this up, drop it on a line" (there will be one) gets it for free.
//
// Generic over WHAT is being dragged (a resource, a chord name — anything)
// via `payload`; genuinely different between pickers — what a drop actually
// DOES with it (append to a line's end vs. resolve a word inside it) — is
// deliberately left to `onDrop`, which this hook hands raw (x, y, payload)
// and nothing more. A chord drop needs the full viewport point (to resolve
// a character offset against the line's text mirror — see
// caretFromPoint.js); a resource drop only needs the line, which it gets by
// running the same lineIndexFromPoint this hook already uses for hover. See
// NoteEditorScreen.jsx's handleDropChord / handleDropResourceOnLine.
//
// `onDragHoverLine` gets the full (lineIndex, x, y, payload) on every tick,
// not just lineIndex — lineIndex alone is enough for a plain row highlight,
// but a LIVE PREVIEW of what the drop would do (NoteEditorScreen's
// resourceDragPreview / chordMovePreview) needs the raw point too, and
// whichever picker's drag this is doesn't otherwise reach the component
// that renders the preview: ChordStrumSheet/ResourcePickerSheet own their
// OWN drag internally, so this is the one channel NoteEditorScreen (their
// shared parent) has into it. Existing callers that only read the first
// argument are unaffected.
export default function useLineDragDrop({ onDragHoverLine, onDragActiveChange, onDrop }) {
  const [drag, setDrag] = useState(null); // { payload, x, y } | null
  // Mirrors `drag`, read synchronously inside the document-level listeners
  // below — attached once (empty-ish deps), so it must never act on a stale
  // closure over `drag` from whatever render set it up.
  const dragRef = useRef(null);

  // Document-level handlers, mirrored into a ref so listeners bound outside
  // the effect below (see `touchTarget` in beginDrag) always call the
  // current ones.
  const handlersRef = useRef(null);
  const targetCleanupRef = useRef(null);

  const unbindTouchTarget = useCallback(() => {
    targetCleanupRef.current?.();
    targetCleanupRef.current = null;
  }, []);

  // `touchTarget`: the element the finger originally went down on, when the
  // gesture starts from something that can be removed from the page while
  // it's still being dragged (a placed chord pill: the moment its phantom
  // hovers a DIFFERENT line, React re-parents it into that line's own strip,
  // which unmounts the node the touch is bound to). A touch's move/end events
  // are delivered to its original target for the whole gesture — and once
  // that node is detached they no longer bubble up to `document`, so the
  // document listeners below go deaf mid-drag and the gesture never ends
  // (same family as the sheet/chip unmount bug fixed in 4180ed5; there the
  // node could simply be kept mounted, here re-parenting is unavoidable).
  // Listening on the target itself keeps hearing the gesture regardless.
  const beginDrag = useCallback((payload, x, y, touchTarget) => {
    const next = { payload, x, y };
    dragRef.current = next;
    setDrag(next);
    unbindTouchTarget();
    if (touchTarget?.addEventListener) {
      const move = (e) => handlersRef.current?.handleMove(e);
      const end = (e) => handlersRef.current?.handleEnd(e);
      const cancel = (e) => handlersRef.current?.handleCancel(e);
      touchTarget.addEventListener('touchmove', move, { passive: false });
      touchTarget.addEventListener('touchend', end);
      touchTarget.addEventListener('touchcancel', cancel);
      targetCleanupRef.current = () => {
        touchTarget.removeEventListener('touchmove', move);
        touchTarget.removeEventListener('touchend', end);
        touchTarget.removeEventListener('touchcancel', cancel);
      };
    }
    // Lets NoteEditorScreen disable pointer-events on its <textarea>s for
    // the drag's whole duration, not just while a specific line is
    // hovered: a mobile browser's native text-selection handling can
    // otherwise claim an in-progress touch the instant it crosses a
    // textarea, which no preventDefault() from either picker's own
    // listeners can undo once it happens. Reported 2026-10-09 as "drag
    // freezes mid-gesture".
    onDragActiveChange?.(true);
  }, [onDragActiveChange, unbindTouchTarget]);

  const endDrag = useCallback((x, y) => {
    const payload = dragRef.current?.payload;
    if (x != null && y != null && payload != null) {
      // Hit-test where the pill visually IS, not the raw finger point that
      // positions it — see effectiveDragPoint's own comment.
      const hit = effectiveDragPoint(x, y);
      onDrop?.(hit.x, hit.y, payload);
    }
    onDragHoverLine?.(null);
    onDragActiveChange?.(false);
    dragRef.current = null;
    unbindTouchTarget();
    setDrag(null);
  }, [onDrop, onDragHoverLine, onDragActiveChange, unbindTouchTarget]);

  useEffect(() => {
    const handleMove = (e) => {
      if (!dragRef.current) return;
      e.preventDefault();
      const t = e.touches[0];
      if (!t) return;
      // `next` (and the `drag` state it becomes) keeps the RAW point —
      // that's what LineDragPill's own x/y props position the floating
      // pill from, offset included. Only the hit-test below switches to
      // the pill's own effective (visual) point.
      const next = { ...dragRef.current, x: t.clientX, y: t.clientY };
      dragRef.current = next;
      setDrag(next);
      const hit = effectiveDragPoint(t.clientX, t.clientY);
      onDragHoverLine?.(lineIndexFromPoint(hit.x, hit.y), hit.x, hit.y, next.payload);
    };
    const handleEnd = (e) => {
      if (!dragRef.current) return;
      const t = e.changedTouches[0];
      endDrag(t?.clientX ?? null, t?.clientY ?? null);
    };
    const handleCancel = () => {
      if (dragRef.current) endDrag(null, null);
    };
    handlersRef.current = { handleMove, handleEnd, handleCancel };
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd);
    document.addEventListener('touchcancel', handleCancel);
    return () => {
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleEnd);
      document.removeEventListener('touchcancel', handleCancel);
    };
  }, [endDrag, onDragHoverLine]);

  // Never leave a listener on a (possibly detached) node past the hook's life.
  useEffect(() => unbindTouchTarget, [unbindTouchTarget]);

  return { drag, beginDrag };
}
