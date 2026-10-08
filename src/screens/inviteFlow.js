// ─── Collaboration invite deep-link flow ───────────────────────────────────
// Opening a shared invite link (?invite=<code>) has to survive a full
// sign-in round trip: this is a magic-link-only app (see auth.js), and the
// OTP redirect strips every query param (emailRedirectTo is just origin +
// pathname) — so the code can't live in the URL across that gap. It's
// stashed in localStorage the instant it's seen, independent of whether a
// session exists yet, and only consumed once one does.
//
// store.js calls captureInviteFromUrl() once at boot and consumeStoredInvite()
// every time state.session changes to a real session; main.js renders the
// transient 'joining'/'error' state in between (see state.inviteStatus).

import { setState, getState } from '../state/store.js';
import { acceptInvite } from '../canvas/collaborationData.js';
import { loadSongById } from './projectsData.js';

const STORAGE_KEY = 'vibecomposer_pending_invite';

// Reads ?invite=<code> off the current URL (if present), stashes it, and
// strips it from the visible address bar — a refresh or back-navigation
// must not re-trigger the same join attempt.
export function captureInviteFromUrl() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('invite');
  if (!code) return;
  try { localStorage.setItem(STORAGE_KEY, code); } catch { /* best-effort; see consumeStoredInvite's own fallback */ }
  url.searchParams.delete('invite');
  window.history.replaceState({}, '', url.pathname + (url.search ? `?${url.searchParams}` : '') + url.hash);
}

// store.js calls this from both getSession().then(...) and onAuthChange,
// which can both fire within the same tick on boot — this guard is what
// keeps that from redeeming (and burning a single-use invite on) the same
// code twice, not any expectation that callers track it themselves.
let consuming = false;

// Call once a real session exists. No-ops instantly if nothing's pending —
// safe to call on every auth-state change rather than tracking "did I
// already try this" separately.
export async function consumeStoredInvite() {
  if (consuming) return;
  let code;
  try { code = localStorage.getItem(STORAGE_KEY); } catch { code = null; }
  if (!code) return;
  consuming = true;

  setState({ inviteStatus: 'joining' });

  const { songId, error } = await acceptInvite(code);
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* nothing more to do if storage is unavailable */ }

  if (error) {
    setState({ inviteStatus: 'error', inviteError: humanizeInviteError(error.message) });
    return;
  }

  const { song, error: songError } = await loadSongById(songId);
  if (songError || !song) {
    setState({ inviteStatus: 'error', inviteError: 'Joined, but the project could not be opened. Try from the projects list.' });
    return;
  }

  // Drop it into the normal songs list too, same as any other open —
  // otherwise it'd only exist in activeSong until the next full reload.
  const { songs } = getState();
  const alreadyListed = songs.some((s) => s.id === song.id);
  setState({
    songs: alreadyListed ? songs : [song, ...songs],
    activeSong: song,
    activeAlbumId: null,
    screen: 'canvas',
    inviteStatus: null,
    inviteError: null,
  });
}

function humanizeInviteError(message) {
  if (/not found/i.test(message)) return 'This invite link is not valid.';
  if (/revoked/i.test(message)) return 'This invite link has been turned off by its owner.';
  if (/expired/i.test(message)) return 'This invite link has expired.';
  if (/already used/i.test(message)) return 'This invite link has already been used.';
  if (/already full/i.test(message)) return 'This project already has its maximum of 4 collaborators.';
  return "Couldn't join this project.";
}

export function dismissInviteError() {
  setState({ inviteStatus: null, inviteError: null });
}
