import { subscribe, getState } from './state/store.js';
import * as MuseScreen    from './screens/muse.js';
import * as PlaceScreen   from './screens/place.js';
import * as PhotoScreen   from './screens/photo.js';
import * as LoadingScreen from './screens/loading.js';
import * as BuilderScreen from './screens/builder.js';
import * as ResultScreen  from './screens/result.js';
import * as ChordScreen   from './screens/chord.js';

const SCREENS = {
  muse:    MuseScreen,
  place:   PlaceScreen,
  photo:   PhotoScreen,
  loading: LoadingScreen,
  builder: BuilderScreen,
  result:  ResultScreen,
  chord:   ChordScreen,
};

const app = document.getElementById('app');

function render(state) {
  const screen = SCREENS[state.screen];
  if (!screen) return;
  app.innerHTML = screen.render(state);
  screen.attach?.(state);
}

subscribe(render);
render(getState());
