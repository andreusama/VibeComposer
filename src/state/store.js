import { readShareUrl } from '../utils/share.js';

// ─── Initial state ─────────────────────────────────────────────────────────────

let state = {
  screen:      'muse',
  // Muse inputs
  phrase:      '',
  place:       '',
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
  error:       null,
};

// Restore shared progression from URL hash
const shared = readShareUrl();
if (shared) {
  state = { ...state, ...shared, screen: 'result' };
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

export function reset() {
  setState({
    screen:      'muse',
    phrase:      '',
    place:       '',
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
  });
}
