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
import { supabase } from '../utils/supabaseClient.js';
import { isGuest } from '../utils/guest.js';

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

// True while someone on the read-only view has asked to sign in to edit. Their
// session is (still) absent or a guest's, so without this the very next auth
// change would just put them straight back on the read-only view.
let signingInToEdit = false;

function storedCode() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

// store.js calls this from both getSession().then(...) and onAuthChange,
// which can both fire within the same tick on boot — this guard is what
// keeps that from redeeming (and burning a single-use invite on) the same
// code twice, not any expectation that callers track it themselves.
let consuming = false;

// Call on every session change, signed in or not.
//   • A real ACCOUNT joins the song as an editor (accept_project_invite).
//   • Anyone else — no session, or a guest session — sees the read-only view
//     (docs/adr/0003): a guest is not an account, and viewing creates nothing.
// No-ops instantly when no link is pending, so it's safe to call every time.
export async function consumeStoredInvite(session) {
  if (consuming) return;
  const code = storedCode();
  if (!code) return;

  const isAccount = Boolean(session) && !isGuest(session);
  if (!isAccount) {
    if (!signingInToEdit) setState({ sharedCode: code });
    return;
  }

  consuming = true;
  signingInToEdit = false;
  setState({ sharedCode: null, inviteStatus: 'joining' });

  try {
    const { songId, error } = await acceptInvite(code);

    // An owner's view-only link never grants editing, even to an account: keep
    // the code (a refresh should still land here) and show the read-only view.
    if (error && /view only/i.test(error.message)) {
      setState({ inviteStatus: null, sharedCode: code });
      return;
    }

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
  } finally {
    consuming = false;
  }
}

// "Inicia sesión para editar" on the read-only view. The link stays stashed, so
// the moment a real account signs in, consumeStoredInvite joins them. A guest
// session is dropped first: the sign-in screen only shows when there is none
// (their demo song is simply left to the 3-day cleanup).
export async function signInToEdit() {
  signingInToEdit = true;
  setState({ sharedCode: null, screen: 'auth' });
  if (isGuest(getState().session)) {
    await supabase.auth.signOut({ scope: 'local' });
  }
}

// Leaves the read-only view for good and forgets the link.
export function leaveSharedView() {
  signingInToEdit = false;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* best-effort */ }
  setState({ sharedCode: null });
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
