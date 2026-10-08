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

getSession().then((session) => {
  setState({ session, sessionChecked: true });
  if (session) consumeStoredInvite();
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
