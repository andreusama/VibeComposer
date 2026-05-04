import { subscribe, getState } from './state/store.js';
import * as LoadingScreen from './screens/loading.js';
import * as BuilderScreen from './screens/builder.js';
import * as ResultScreen  from './screens/result.js';
import * as ChordScreen   from './screens/chord.js';

// ─── Screen registry ───────────────────────────────────────────────────────────
// Maps screen names to their render/attach modules.
// Adding a new screen = add one entry here.

const SCREENS = {
  loading: LoadingScreen,
  builder: BuilderScreen,
  result:  ResultScreen,
  chord:   ChordScreen,
};

// ─── Render loop ───────────────────────────────────────────────────────────────

const app = document.getElementById('app');

function render(state) {
  const screen = SCREENS[state.screen];
  if (!screen) return;

  app.innerHTML = screen.render(state);
  screen.attach?.(state);   // attach is optional (loading screen has none)
}

// ─── Boot ──────────────────────────────────────────────────────────────────────

subscribe(render);
render(getState());   // draw the initial screen on page load
