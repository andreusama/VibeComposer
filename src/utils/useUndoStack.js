import { useRef, useReducer, useCallback } from 'react';

// Multi-step in-memory undo/redo for a single editable value (a string, an
// array of line objects — whatever the caller snapshots). Session-only, not
// persisted. `snapshot(value)` records the state BEFORE a mutation;
// `undo(current)` / `redo(current)` return the value to move to (or
// undefined when the stack is empty). `coalesce: true` folds a burst of
// rapid snapshots (typing) into one step at ~phrase granularity.
export function useUndoStack(cap = 100) {
  const ref = useRef({ undo: [], redo: [] });
  const [, tick] = useReducer((n) => n + 1, 0);
  const coalesceRef = useRef(null);

  const snapshot = useCallback((value, { coalesce = false } = {}) => {
    if (coalesce) {
      if (coalesceRef.current) {
        clearTimeout(coalesceRef.current);
        coalesceRef.current = setTimeout(() => { coalesceRef.current = null; }, 600);
        return;
      }
      coalesceRef.current = setTimeout(() => { coalesceRef.current = null; }, 600);
    }
    const { undo } = ref.current;
    undo.push(value);
    if (undo.length > cap) undo.shift();
    ref.current.redo = [];
    tick();
  }, [cap]);

  const undo = useCallback((current) => {
    const s = ref.current;
    if (!s.undo.length) return undefined;
    s.redo.push(current);
    tick();
    return s.undo.pop();
  }, []);

  const redo = useCallback((current) => {
    const s = ref.current;
    if (!s.redo.length) return undefined;
    s.undo.push(current);
    tick();
    return s.redo.pop();
  }, []);

  const reset = useCallback(() => { ref.current = { undo: [], redo: [] }; tick(); }, []);

  return {
    snapshot,
    undo,
    redo,
    reset,
    canUndo: ref.current.undo.length > 0,
    canRedo: ref.current.redo.length > 0,
  };
}
