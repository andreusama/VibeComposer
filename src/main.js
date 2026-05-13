import { subscribe, getState } from './state/store.js';
import * as MuseScreen    from './screens/muse.js';
import * as PlaceScreen   from './screens/place.js';
import * as PhotoScreen   from './screens/photo.js';
import * as LoadingScreen from './screens/loading.js';
import * as BuilderScreen from './screens/builder.js';
import * as ResultScreen  from './screens/result.js';
import * as ChordScreen   from './screens/chord.js';
import * as StudioScreen  from './screens/studio.js';

const SCREENS = {
  muse:    MuseScreen,
  place:   PlaceScreen,
  photo:   PhotoScreen,
  loading: LoadingScreen,
  builder: BuilderScreen,
  result:  ResultScreen,
  chord:   ChordScreen,
  studio:  StudioScreen,
};

const app = document.getElementById('app');

function render(state) {
  const screen = SCREENS[state.screen];
  if (!screen) return;
  app.innerHTML = screen.render(state);
  screen.attach?.(state);
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