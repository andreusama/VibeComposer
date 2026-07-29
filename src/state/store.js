import { readShareUrl } from '../utils/share.js';
import { supabase, onAuthChange, getSession } from '../utils/supabaseClient.js';

// ─── Initial state ─────────────────────────────────────────────────────────────

let state = {
  screen:      'home',
  // Muse inputs
  phrase:      '',
  place:       '',
  skipPhrase:  false,
  skipPlace:   false,
  skipPhoto:   false,
  // Vibe refinement
  rgb:         { r: 107, g: 140, b: 174 },
  energy:      50,
  flavour:     null,
  texture:     null,
  easyMode:    true,
  // Result
  vibeLabel:   null,
  progression: null,
  activeChord: 0,
  photoUrl:    null,
  error:       null,
  // Auth + projects
  session:        null,
  sessionChecked: false,
  activeSong:     null,
  songs:          [],
  projectError:   null,
  // True only when the current 'result' state came from a shared URL, not from
  // a logged-in session — lets a shared link stay viewable without an account.
  publicView:     false,
};

// ─── Auth session sync ──────────────────────────────────────────────────────────
// Hydrates state.session on boot and keeps it in sync (magic-link redirects,
// sign-out from another tab, token refresh).

getSession().then((session) => setState({ session, sessionChecked: true }));
onAuthChange((session) => setState({ session }));

// Restore shared progression from URL hash — viewable without signing in.
const shared = readShareUrl();
if (shared) {
  state = { ...state, ...shared, screen: 'result', publicView: true };
}

// ─── Pub/sub ───────────────────────────────────────────────────────────────────

let _listener = null;
export function subscribe(fn) { _listener = fn; }
export function getState()    { return state; }

export function setState(partial) {
  state = { ...state, ...partial };
  _listener?.(state);
}

// ─── Actions ───────────────────────────────────────────────────────────────────

export function reset(overrides = {}) {
  setState({
    screen:      'muse',
    phrase:      null,
    place:       '',
    skipPhrase:  false,
    skipPlace:   false,
    skipPhoto:   false,
    rgb:         { r: 107, g: 140, b: 174 },
    energy:      50,
    flavour:     null,
    texture:     null,
    vibeLabel:   null,
    progression: null,
    activeChord: 0,
    error:       null,
    ...overrides,
  });
}

// Enter the "chords" side of a project: restore its saved vibe_snapshot if it
// has one (so re-opening a project shows exactly what you composed before),
// or drop into a fresh compose flow for it if it doesn't have one yet.
//
// Both branches set activeSong and screen together in one setState call —
// splitting them (reset() then a second setState) leaves a moment where
// screen is already 'muse' but activeSong is still null, and muse.js's own
// "no activeSong, bounce to home" guard fires on that moment, briefly
// derailing navigation before the second call corrects it.
export function enterProjectChords(song) {
  if (song.vibe_snapshot) {
    const s = song.vibe_snapshot;
    setState({
      activeSong:  song,
      phrase:      s.phrase,
      place:       s.place,
      rgb:         s.rgb,
      energy:      s.energy,
      flavour:     s.flavour,
      texture:     s.texture,
      easyMode:    s.easyMode,
      photoUrl:    s.photoUrl,
      vibeLabel:   s.vibeLabel,
      progression: s.progression,
      screen:      'result',
    });
  } else {
    reset({ activeSong: song });
  }
}

// Single source of truth for persisting the composer's current output onto
// its project — used both right after composing and by the explicit "save"
// button on the result screen (composing alone was silently failing to
// surface write errors; this always returns one so callers can show it).
export async function saveProjectSnapshot(state) {
  if (!state.activeSong)  return { error: { message: 'No project is open.' } };
  if (!state.progression) return { error: { message: 'Nothing composed yet.' } };

  const snapshot = {
    phrase: state.phrase, place: state.place, rgb: state.rgb,
    energy: state.energy, flavour: state.flavour, texture: state.texture,
    easyMode: state.easyMode, photoUrl: state.photoUrl,
    vibeLabel: state.vibeLabel, progression: state.progression,
  };

  const { error } = await supabase
    .from('songs').update({ vibe_snapshot: snapshot }).eq('id', state.activeSong.id);

  return { error };
}
