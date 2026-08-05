// Minimal pub-sub so the toolbar's "saved" / "saving…" indicator can reflect
// writes happening deep inside individual node components (debounced text
// edits, position saves on drag) without prop-drilling a callback through
// every node type that persists something.
let pending = 0;
const listeners = new Set();

function notify() {
  listeners.forEach((fn) => fn(pending));
}

export function beginSave() {
  pending += 1;
  notify();
}

export function endSave() {
  pending = Math.max(0, pending - 1);
  notify();
}

export function subscribeSaveStatus(fn) {
  listeners.add(fn);
  fn(pending);
  return () => listeners.delete(fn);
}
