import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { subscribe, getState, setState } from './state/store.js';
import CanvasScreen from './canvas/CanvasScreen.jsx';
import SongThreadScreen from './canvas/SongThreadScreen.jsx';
import MobileProjectsScreen from './screens/MobileProjectsScreen.jsx';
import MuseEyeScreen from './canvas/MuseEyeScreen.jsx';
import * as LoadingScreen     from './screens/loading.js';
import * as StudioScreen      from './screens/studio.js';
import * as AuthScreen        from './screens/auth.js';
import * as HomeScreen        from './screens/home.js';

const SCREENS = {
  loading:        LoadingScreen,
  studio:         StudioScreen,
  auth:           AuthScreen,
  home:           HomeScreen,
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

// Matches style.css's own "narrow viewports (phones, half-split windows)"
// breakpoint — below it, the canvas's free-form 2D layout doesn't work on
// touch (see ROADMAP.md Phase 1), so the song thread's linear card list
// takes over instead.
const MOBILE_BREAKPOINT = 640;
const isMobileViewport = () => window.innerWidth <= MOBILE_BREAKPOINT;

function render(state) {
  if (!state.sessionChecked) {
    if (reactRoot) { reactRoot.unmount(); reactRoot = null; }
    app.innerHTML = LoadingScreen.render();
    lastEffectiveScreen = null;
    return;
  }

  const screenKey = (state.session || PUBLIC_SCREENS.has(state.screen)) ? state.screen : 'auth';

  const justEntered = screenKey !== lastEffectiveScreen;
  lastEffectiveScreen = screenKey;

  if (screenKey === 'canvas') {
    if (!reactRoot) reactRoot = createRoot(app);
    const ScreenComponent = isMobileViewport() ? SongThreadScreen : CanvasScreen;
    reactRoot.render(createElement(ScreenComponent, {
      state,
      justEntered,
      onExit: () => setState({ screen: 'home' }),
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

  if (screenKey === 'home' && isMobileViewport()) {
    if (!reactRoot) reactRoot = createRoot(app);
    reactRoot.render(createElement(MobileProjectsScreen, { state, justEntered }));
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

setAccentFromState(getState());
render(getState());

// Only meant for browser-window/device-emulation testing crossing
// MOBILE_BREAKPOINT — but real mobile browsers fire `resize` far more than
// that: the on-screen keyboard opening/closing, and Android Chrome's
// address bar hiding/showing on scroll, both fire it constantly. Without
// the isMobile !== lastIsMobile guard, every one of those re-rendered the
// whole app from a fresh getState() snapshot mid-interaction (e.g. while a
// song-thread rename/language sheet was mid-edit) — a class of disruption
// desktop never hits, since nobody resizes their browser window while
// typing. Now it only actually re-renders when the breakpoint is crossed,
// which is the one case this was ever meant to handle.
let resizeTimer = null;
let lastIsMobile = isMobileViewport();
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const nowMobile = isMobileViewport();
    if (nowMobile === lastIsMobile) return;
    lastIsMobile = nowMobile;
    render(getState());
  }, 150);
});