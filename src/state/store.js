import { supabase, onAuthChange, getSession } from '../utils/supabaseClient.js';
import { captureInviteFromUrl, consumeStoredInvite } from '../screens/inviteFlow.js';

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
  // Albums group songs as tracks (a song with album_id = null is a single).
  // activeAlbumId is set while inside an album screen, and is also what a
  // song's back button reads to return there instead of to the projects list.
  albums:         [],
  activeAlbumId:  null,
  // Which page of the bottom tab bar (MobileHomePager.jsx) is active —
  // 'projects' | 'resources'. Lives here (not local component state) so a
  // song/album drill-down that fully unmounts the pager and returns to it
  // doesn't reset you back to the first tab.
  homeTab:        'projects',
  // Distinguishes "haven't fetched yet" from "fetched, genuinely zero
  // projects" — songs alone can't tell those apart (both are `[]`), which
  // let the projects screens flash an empty state during the real fetch.
  songsLoaded:    false,
  projectError:   null,
  // Set while a ?invite=<code> link is being redeemed after sign-in (see
  // src/screens/inviteFlow.js) — null the rest of the time. main.js shows a
  // small transient screen for 'joining'/'error' instead of the normal one.
  inviteStatus:   null,
  inviteError:    null,
};

// ─── Auth session sync ──────────────────────────────────────────────────────────
// Hydrates state.session on boot and keeps it in sync (magic-link redirects,
// sign-out from another tab, token refresh).

// Must run before the first setState so a pending invite is stashed even if
// this tab has no session yet (captureInviteFromUrl is synchronous and
// doesn't depend on auth state at all).
captureInviteFromUrl();

// This is the single gate the ENTIRE app sits behind on every boot
// (main.js's render(): `if (!state.sessionChecked) { show LoadingScreen;
// return; }`, nothing else ever renders until this resolves) — so it gets
// a `.catch()` no matter how deep the Supabase SDK's own internal error
// handling goes. getSession() stays fast in the common case (a cached,
// non-expired session resolves straight from localStorage, no network
// call at all) but falls through to a real token-refresh request when the
// cached session has expired, and that request can fail or stall like any
// other — the client-level fetch timeout (supabaseClient.js) now bounds
// how LONG that can hang, but a plain `.then()` with nothing to catch an
// eventual rejection still leaves sessionChecked stuck at its initial
// `false` forever, which means the loading screen that's covering the
// entire app never goes away either — reported 2026-10-20 as "infinite
// loading when entering the page". Treating a failure as "no session" is
// the safe fallback either way: worst case the person lands on the auth
// screen and signs in again, instead of staring at a loading screen with
// no recovery.
getSession().then((session) => {
  setState({ session, sessionChecked: true });
  if (session) consumeStoredInvite();
}).catch(() => {
  setState({ session: null, sessionChecked: true });
});
onAuthChange((session) => {
  setState({ session });
  if (session) consumeStoredInvite();
});

// ─── Pub/sub ───────────────────────────────────────────────────────────────────

let _listener = null;
export function subscribe(fn) { _listener = fn; }
export function getState()    { return state; }

export function setState(partial) {
  state = { ...state, ...partial };
  _listener?.(state);
}
