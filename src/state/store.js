import { supabase, onAuthChange, getSession } from '../utils/supabaseClient.js';

// ─── Initial state ─────────────────────────────────────────────────────────────

let state = {
  screen:      'home',
  // Generic default accent — boot-time --accent CSS var and studio's fallback
  // color when a progression has no vibe_meta of its own (e.g. a manually
  // created one).
  rgb:         { r: 107, g: 140, b: 174 },
  energy:      50,
  // Populated by a chord-progression node's "arrange" action right before
  // switching to the studio screen — { title, key, progression, energy, rgb }.
  // Studio reads only from this, never from the fields above directly.
  studioSource: null,
  // Auth + projects
  session:        null,
  sessionChecked: false,
  activeSong:     null,
  songs:          [],
  projectError:   null,
};

// ─── Auth session sync ──────────────────────────────────────────────────────────
// Hydrates state.session on boot and keeps it in sync (magic-link redirects,
// sign-out from another tab, token refresh).

getSession().then((session) => setState({ session, sessionChecked: true }));
onAuthChange((session) => setState({ session }));

// ─── Pub/sub ───────────────────────────────────────────────────────────────────

let _listener = null;
export function subscribe(fn) { _listener = fn; }
export function getState()    { return state; }

export function setState(partial) {
  state = { ...state, ...partial };
  _listener?.(state);
}
