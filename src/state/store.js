import { readShareUrl } from '../utils/share.js';

// ─── Initial state ─────────────────────────────────────────────────────────────

let state = {
  screen:     'builder',
  rgb:        { r: 107, g: 140, b: 174 }, // default: melancholic blue
  energy:     50,
  flavour:    null,
  texture:    null,
  easyMode:   true,
  vibeLabel:  null,   // saved on compose for display in result/chord screens
  progression: null,
  activeChord: 0,
  error:       null,
};

// Restore a shared progression from the URL hash on load
const shared = readShareUrl();
if (shared) {
  state.progression = shared.progression;
  state.vibeLabel   = shared.vibeLabel || null;
  state.screen      = 'result';
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
    rgb:        { r: 107, g: 140, b: 174 },
    energy:     50,
    flavour:    null,
    texture:    null,
    vibeLabel:  null,
    progression: null,
    activeChord: 0,
    error:       null,
    screen:     'builder',
  });
}
