import { useEffect, useState } from 'react';
import { setState } from '../state/store.js';
import MobileScreen from '../mobile/MobileScreen.jsx';
import MobileTabBar from '../mobile/MobileTabBar.jsx';
import useSwipePager from '../mobile/useSwipePager.js';
import MobileProjectsScreen from './MobileProjectsScreen.jsx';
import MobileResourcesScreen from '../resources/MobileResourcesScreen.jsx';
import { IcMusicNote, IcBook } from '../mobile/icons.jsx';

const PAGES = ['projects', 'resources'];
const TABS = [
  { key: 'projects', label: 'Proyectos', icon: <IcMusicNote size={22} /> },
  { key: 'resources', label: 'Recursos', icon: <IcBook size={22} /> },
];

// The bottom-tab-bar home screen: Proyectos and Recursos as two pages of one
// horizontal strip (src/mobile/useSwipePager.js), tapping a tab or swiping
// both drive the same `state.homeTab`. Neither page unmounts while
// switching between them — only drilling into a song/album (which covers
// this whole pager, see main.js) unmounts it.
export default function MobileHomePager({ state, justEntered }) {
  const index = Math.max(0, PAGES.indexOf(state.homeTab || 'projects'));
  const setIndex = (next) => setState({ homeTab: PAGES[next] });
  const pager = useSwipePager({ count: PAGES.length, index, setIndex });

  // Both pages stay mounted, but each only fetches its own data when it's
  // actually the one on screen: the first time it becomes the active page,
  // or on a fresh `justEntered` while already active. Otherwise entering the
  // pager on the Proyectos tab would silently also fire the whole Recursos
  // library load (resources + folders + membership) every time, whether or
  // not that tab is ever opened this session.
  const [visited, setVisited] = useState(() => new Set([index]));
  useEffect(() => {
    setVisited((v) => (v.has(index) ? v : new Set(v).add(index)));
  }, [index]);
  const enter = (i) => (index === i && (justEntered || !visited.has(i)));

  return (
    <MobileScreen className="home-pager-shell">
      <div className="home-pager-viewport" {...pager.handlers}>
        <div
          className="home-pager-track"
          style={{ left: pager.offsetPx, transition: pager.dragging ? 'none' : undefined }}
        >
          <MobileProjectsScreen state={state} justEntered={enter(0)} />
          <MobileResourcesScreen state={state} justEntered={enter(1)} />
        </div>
      </div>
      <MobileTabBar tabs={TABS} active={PAGES[index]} onSelect={(key) => setIndex(PAGES.indexOf(key))} />
    </MobileScreen>
  );
}
