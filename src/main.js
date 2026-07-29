import { subscribe, getState } from './state/store.js';
import * as MuseScreen        from './screens/muse.js';
import * as PlaceScreen       from './screens/place.js';
import * as PhotoScreen       from './screens/photo.js';
import * as LoadingScreen     from './screens/loading.js';
import * as BuilderScreen     from './screens/builder.js';
import * as ResultScreen      from './screens/result.js';
import * as ChordScreen       from './screens/chord.js';
import * as StudioScreen      from './screens/studio.js';
import * as AuthScreen        from './screens/auth.js';
import * as HomeScreen        from './screens/home.js';
import * as LyricsEditorScreen from './screens/lyricsEditor.js';

const SCREENS = {
  muse:           MuseScreen,
  place:          PlaceScreen,
  photo:          PhotoScreen,
  loading:        LoadingScreen,
  builder:        BuilderScreen,
  result:         ResultScreen,
  chord:          ChordScreen,
  studio:         StudioScreen,
  auth:           AuthScreen,
  home:           HomeScreen,
  'lyrics-editor': LyricsEditorScreen,
};

// Screens reachable without a session: the auth screen itself, and — when the
// current state came from a shared URL (state.publicView) — the read-only
// viewing screens, so a shared link stays viewable without an account.
const PUBLIC_SCREENS       = new Set(['auth']);
const PUBLIC_VIEW_SCREENS  = new Set(['result', 'chord', 'studio']);

const app = document.getElementById('app');

// The *effective* screen (after the auth gate below overrides state.screen)
// is the only reliable signal for "did we just navigate here" — state.screen
// itself doesn't change during a sign-out/sign-in cycle while sitting on the
// same nominal screen, but what's actually rendered does. Screens use the
// justEntered flag to fetch their data once per real arrival, not once per
// setState call (which would either go stale or, if the fetch itself calls
// setState on completion, loop forever).
let lastEffectiveScreen = null;

function render(state) {
  if (!state.sessionChecked) {
    app.innerHTML = LoadingScreen.render();
    lastEffectiveScreen = null;
    return;
  }

  const isPublic = PUBLIC_SCREENS.has(state.screen)
    || (state.publicView && PUBLIC_VIEW_SCREENS.has(state.screen));

  const screenKey = (state.session || isPublic) ? state.screen : 'auth';
  const screen = SCREENS[screenKey];
  if (!screen) return;

  const justEntered = screenKey !== lastEffectiveScreen;
  lastEffectiveScreen = screenKey;

  app.innerHTML = screen.render(state);
  screen.attach?.(state, justEntered);
}

// Set accent color from default RGB on boot so treble clef is always visible
function setAccentFromState(state) {
  const { r, g, b } = state.rgb;
  const hex = (v) => Math.round(v).toString(16).padStart(2, '0');
  const accent = `#${hex(r)}${hex(g)}${hex(b)}`;
  document.documentElement.style.setProperty('--accent', accent);
}

subscribe((state) => {
  setAccentFromState(state);
  render(state);
});

setAccentFromState(getState());
render(getState());