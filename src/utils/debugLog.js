// ─── Debug log — a tiny in-memory pub-sub, no persistence, no deps ─────────
// Anything in the app that produces debug telemetry (starting with the
// muse's _debug payload, pushed automatically from askMuse itself — see
// museApi.js) lands here instead of only rendering it locally — that's
// what lets DebugConsole/MuseEyeScreen show a running history across every
// real call, everywhere in the app, not just whatever the last inline
// panel happened to capture. Lives in utils/, not canvas/, specifically so
// museApi.js (a utils module) can import it without a canvas -> utils ->
// canvas dependency loop.
//
// Every entry also mirrors to the browser's own DevTools console, grouped
// and namespaced — the actual industry-standard place developers already
// know to look. The in-app overlay (DebugConsole.jsx, opened with the `
// key) is a convenience on top of that, not a replacement for it.

const MAX_ENTRIES = 200;
let entries = [];
const listeners = new Set();

// meta is optional, additive context about WHERE this payload came from
// (songId/songTitle/nodeLabel for a muse call) — MuseEyeScreen uses it to
// render the same footer MuseEyePanel shows inline, without needing a
// second live query. Callers that don't have it (or don't care) can omit
// it entirely; existing behavior is unchanged either way.
export function logDebugEvent(source, payload, meta = {}) {
  const entry = { id: crypto.randomUUID(), source, payload, meta, at: new Date() };
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
