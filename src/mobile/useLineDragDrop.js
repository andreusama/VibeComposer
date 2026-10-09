import { useCallback, useEffect, useRef, useState } from 'react';
import { lineIndexFromPoint } from '../utils/lineHitTest.js';

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

  const beginDrag = useCallback((payload, x, y) => {
    const next = { payload, x, y };
    dragRef.current = next;
    setDrag(next);
    // Lets NoteEditorScreen disable pointer-events on its <textarea>s for
    // the drag's whole duration, not just while a specific line is
    // hovered: a mobile browser's native text-selection handling can
    // otherwise claim an in-progress touch the instant it crosses a
    // textarea, which no preventDefault() from either picker's own
    // listeners can undo once it happens. Reported 2026-10-09 as "drag
    // freezes mid-gesture".
    onDragActiveChange?.(true);
  }, [onDragActiveChange]);

  const endDrag = useCallback((x, y) => {
    const payload = dragRef.current?.payload;
    if (x != null && y != null && payload != null) onDrop?.(x, y, payload);
    onDragHoverLine?.(null);
    onDragActiveChange?.(false);
    dragRef.current = null;
    setDrag(null);
  }, [onDrop, onDragHoverLine, onDragActiveChange]);

  useEffect(() => {
    const handleMove = (e) => {
      if (!dragRef.current) return;
      e.preventDefault();
      const t = e.touches[0];
      if (!t) return;
      const next = { ...dragRef.current, x: t.clientX, y: t.clientY };
      dragRef.current = next;
      setDrag(next);
      onDragHoverLine?.(lineIndexFromPoint(t.clientX, t.clientY), t.clientX, t.clientY, next.payload);
    };
    const handleEnd = (e) => {
      if (!dragRef.current) return;
      const t = e.changedTouches[0];
      endDrag(t?.clientX ?? null, t?.clientY ?? null);
    };
    const handleCancel = () => {
      if (dragRef.current) endDrag(null, null);
    };
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd);
    document.addEventListener('touchcancel', handleCancel);
    return () => {
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleEnd);
      document.removeEventListener('touchcancel', handleCancel);
    };
  }, [endDrag, onDragHoverLine]);

  return { drag, beginDrag };
}
