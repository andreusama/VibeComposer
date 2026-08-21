import { useState, useEffect, useMemo } from 'react';
import { setState } from '../state/store.js';
import { loadProjectSummaries, computePreviewLayout, createProject, deleteSong } from './projectsData.js';
import MobileScreen from '../mobile/MobileScreen.jsx';
import MobileFab from '../mobile/MobileFab.jsx';
import MobileTabBar from '../mobile/MobileTabBar.jsx';

const TABS = [
  { key: 'projects', icon: '♫', label: 'Projects' },
  { key: 'profile', icon: '☺', label: 'Profile' },
];

// "edited today" for anything from the last 24h of calendar days, otherwise
// a plain lowercase date — matches the design mockup's two label styles
// without needing a full relative-time library for just two cases.
function formatEdited(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) return 'edited today';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).toLowerCase();
}

function ProjectThumbnail({ nodes, links }) {
  const { points, lines } = useMemo(() => computePreviewLayout(nodes || [], links || []), [nodes, links]);
  return (
    <div className="mp-thumb">
      {points.length > 0 && (
        <svg className="mp-thumb-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          {lines.map((l, i) => <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />)}
          {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="4" />)}
        </svg>
      )}
    </div>
  );
}

// A <div role="button"> wrapper, not a <button>, now that the row needs a
// second, independently-tappable delete action inside it — a button can't
// contain another button (invalid HTML, and the nested one silently never
// receives its own click). onKeyDown mirrors a real button's Enter/Space
// activation so this doesn't lose keyboard accessibility for it.
function ProjectRow({ song, onOpen, onDelete }) {
  const nodeCount = song.nodeCount || 0;
  return (
    <div
      className="mp-row"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
    >
      <ProjectThumbnail nodes={song.previewNodes} links={song.previewLinks} />
      <div className="mp-row-body">
        <div className="mp-row-title">{song.title || 'untitled'}</div>
        <div className="mp-row-meta">
          {nodeCount} node{nodeCount === 1 ? '' : 's'} · {formatEdited(song.updated_at)}
        </div>
      </div>
      <button
        className="mp-row-delete"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        title="Delete project"
      >
        🗑
      </button>
      <span className="mp-row-chevron">›</span>
    </div>
  );
}

export default function MobileProjectsScreen({ state, justEntered }) {
  const songs = state.songs || [];
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  const loadSongs = () => {
    loadProjectSummaries().then(({ songs, error }) => setState({ songs, projectError: error, songsLoaded: true }));
  };

  useEffect(() => {
    if (!justEntered) return;
    loadSongs();
  }, [justEntered]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return songs;
    return songs.filter((s) => (s.title || 'untitled').toLowerCase().includes(q));
  }, [songs, query]);

  const openSong = (song) => setState({ activeSong: song, screen: 'canvas' });

  const handleDeleteProject = async (song) => {
    if (!confirm(`Delete "${song.title || 'this project'}"? This can't be undone.`)) return;
    const { error } = await deleteSong(song.id);
    if (error) { setState({ projectError: error.message }); return; }
    setState({ songs: songs.filter((s) => s.id !== song.id) });
  };

  const handleNewProject = async () => {
    if (creating || !state.session?.user?.id) return;
    setCreating(true);
    try {
      const { song, error } = await createProject(state.session.user.id);
      if (error || !song) return;
      setState({ songs: [song, ...songs], projectError: null });
      openSong(song);
    } finally {
      setCreating(false);
    }
  };

  return (
    <MobileScreen className="mp-screen">
      <div className="mp-body">
        <div className="mp-header glass">
          <h1 className="mp-title">Projects</h1>
          <div className="mp-search">
            <span className="mp-search-icon">⌕</span>
            <input
              type="text"
              placeholder="Search"
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {!state.songsLoaded ? (
          <div className="mp-loading"><span className="mp-spinner" /></div>
        ) : (
          <>
            {state.projectError && (
              <p className="thread-status thread-status-error">
                {state.projectError}{' '}
                <button className="mp-retry-btn" onClick={loadSongs}>Retry</button>
              </p>
            )}
            {!state.projectError && filtered.length === 0 && (
              <div className="thread-empty"><p>No projects yet.</p></div>
            )}
            {filtered.map((song) => (
              <ProjectRow
                key={song.id}
                song={song}
                onOpen={() => openSong(song)}
                onDelete={() => handleDeleteProject(song)}
              />
            ))}
          </>
        )}
      </div>

      <MobileFab onClick={handleNewProject} pending={creating} title="New project" aboveTabBar />

      {/* "Profile" has no screen behind it yet — tab shown for the design's
          bottom-nav chrome, not wired to anything until that phase exists. */}
      <MobileTabBar active="projects" tabs={TABS} />
    </MobileScreen>
  );
}
