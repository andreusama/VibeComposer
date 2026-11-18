import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { subscribe, getState, setState } from './state/store.js';
import SongThreadScreen from './canvas/SongThreadScreen.jsx';
import MobileHomePager from './screens/MobileHomePager.jsx';
import MobileAlbumScreen from './screens/MobileAlbumScreen.jsx';
import MuseEyeScreen from './canvas/MuseEyeScreen.jsx';
import * as LoadingScreen     from './screens/loading.js';
import * as JoiningScreen     from './screens/joining.js';
import * as StudioScreen      from './screens/studio.js';
import * as AuthScreen        from './screens/auth.js';
import SharedSongScreen from './screens/SharedSongScreen.jsx';
import { signInToEdit, leaveSharedView } from './screens/inviteFlow.js';
import { isGuest } from './utils/guest.js';
import { initInputMode } from './utils/inputMode.js';
import { installEscapeCloses } from './utils/escapeCloses.js';

const SCREENS = {
  loading:        LoadingScreen,
  studio:         StudioScreen,
  auth:           AuthScreen,
};

// The only screen reachable without a session — everything else (including
// studio, now only reachable from a signed-in canvas via a progression's
// "arrange" action) requires being logged in.
const PUBLIC_SCREENS = new Set(['auth']);

const app = document.getElementById('app');

// The *effective* screen (after the auth gate below overrides state.screen)
// is the only reliable signal for "did we just navigate here" — state.screen
// itself doesn't change during a sign-out/sign-in cycle while sitting on the
// same nominal screen, but what's actually rendered does. Screens use the
// justEntered flag to fetch their data once per real arrival, not once per
// setState call (which would either go stale or, if the fetch itself calls
// setState on completion, loop forever).
let lastEffectiveScreen = null;

// The canvas screen is React-rendered (React Flow) — everything else is the
// existing vanilla innerHTML-based renderer. One React root gets mounted
// into #app only while the canvas is the effective screen, and explicitly
// unmounted before any vanilla screen writes to app.innerHTML again — letting
// vanilla code clobber #app while React still thinks it owns that subtree
// would desync React's internal tree from the real DOM.
let reactRoot = null;

function render(state) {
  if (!state.sessionChecked) {
    if (reactRoot) { reactRoot.unmount(); reactRoot = null; }
    app.innerHTML = LoadingScreen.render();
    lastEffectiveScreen = null;
    return;
  }

  // A pending invite redeems itself right after sign-in (inviteFlow.js),
  // before anything else about where to land is decided — this screen owns
  // the whole page until that resolves, same as the sessionChecked gate
  // above.
  if (state.inviteStatus) {
    if (reactRoot) { reactRoot.unmount(); reactRoot = null; }
    app.innerHTML = JoiningScreen.render(state);
    JoiningScreen.attach(state);
    lastEffectiveScreen = null;
    return;
  }

  // A share link opened without an account: the read-only view of the song,
  // before anything about where else to land is decided.
  if (state.sharedCode) {
    if (!reactRoot) reactRoot = createRoot(app);
    reactRoot.render(createElement(SharedSongScreen, {
      code: state.sharedCode,
      isAccount: Boolean(state.session) && !isGuest(state.session),
      onSignIn: signInToEdit,
      onLeave: leaveSharedView,
    }));
    lastEffectiveScreen = null;
    return;
  }

  const screenKey = (state.session || PUBLIC_SCREENS.has(state.screen)) ? state.screen : 'auth';

  const justEntered = screenKey !== lastEffectiveScreen;
  lastEffectiveScreen = screenKey;

  if (screenKey === 'canvas') {
    if (!reactRoot) reactRoot = createRoot(app);
    reactRoot.render(createElement(SongThreadScreen, {
      state,
      justEntered,
      // A track opened from inside an album returns to that album, not to
      // the projects list (activeAlbumId is cleared whenever a single opens).
      onExit: () => setState({ screen: getState().activeAlbumId ? 'album' : 'home' }),
    }));
    return;
  }

  // Full-page real-data debug viewer — dev-only, gated here too (not just
  // at its home-screen entry point) so poking state.screen from outside
  // this app can't reach it in a production build.
  if (screenKey === 'museeye') {
    if (!import.meta.env.DEV) { setState({ screen: 'home' }); return; }
    if (!reactRoot) reactRoot = createRoot(app);
    reactRoot.render(createElement(MuseEyeScreen, {
      onExit: () => setState({ screen: 'home' }),
    }));
    return;
  }

  if (screenKey === 'album') {
    if (!reactRoot) reactRoot = createRoot(app);
    reactRoot.render(createElement(MobileAlbumScreen, { state, justEntered }));
    return;
  }

  if (screenKey === 'home') {
    if (!reactRoot) reactRoot = createRoot(app);
    reactRoot.render(createElement(MobileHomePager, { state, justEntered }));
    return;
  }

  if (reactRoot) { reactRoot.unmount(); reactRoot = null; }

  const screen = SCREENS[screenKey];
  if (!screen) return;

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

initInputMode();
installEscapeCloses();
setAccentFromState(getState());
render(getState());
