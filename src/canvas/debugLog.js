// ─── Debug log — a tiny in-memory pub-sub, no persistence, no deps ─────────
// Anything in the app that produces debug telemetry (starting with the
// muse's _debug payload) pushes it here instead of only rendering it
// locally — that's what lets DebugConsole show a running history across
// multiple calls/nodes instead of just "whatever the last inline panel
// happened to capture."
//
// Every entry also mirrors to the browser's own DevTools console, grouped
// and namespaced — the actual industry-standard place developers already
// know to look. The in-app overlay (DebugConsole.jsx, opened with the `
// key) is a convenience on top of that, not a replacement for it.

const MAX_ENTRIES = 200;
let entries = [];
const listeners = new Set();

export function logDebugEvent(source, payload) {
  const entry = { id: crypto.randomUUID(), source, payload, at: new Date() };
  entries = [...entries, entry].slice(-MAX_ENTRIES);
  listeners.forEach((fn) => fn(entries));

  console.groupCollapsed(
    `%c${source}%c ${entry.at.toLocaleTimeString()}`,
    'color:#B8842A;font-weight:600',
    'color:inherit'
  );
  console.log(payload);
  console.groupEnd();
}

export function subscribeDebugLog(fn) {
  listeners.add(fn);
  fn(entries);
  return () => listeners.delete(fn);
}

export function clearDebugLog() {
  entries = [];
  listeners.forEach((fn) => fn(entries));
}
