import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { setState } from '../state/store.js';
import { loadProjectSummaries, computePreviewLayout, createProject, deleteSong } from './projectsData.js';
import MobileScreen from '../mobile/MobileScreen.jsx';
import MobileFab from '../mobile/MobileFab.jsx';
import MobileTabBar from '../mobile/MobileTabBar.jsx';
import { IcSearch, IcChevronRight } from '../mobile/icons.jsx';

const TABS = [
  { key: 'projects', label: 'Proyectos' },
  { key: 'profile', label: 'Perfil' },
];

// "editado hoy" for anything from the last 24h of calendar days, otherwise a
// plain lowercase date.
function formatEdited(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return 'editado hoy';
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).toLowerCase();
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

const REVEAL = 84; // px of the delete action revealed on a full swipe-left

// Each project is its own elevated card (white on the deeper screen ground,
// with BOTH a shadow and a 1.5px border — two independent contrast cues, see
// .mp-card in style.css). The card also slides left to reveal "Eliminar".
function ProjectRow({ song, onOpen, onDelete }) {
  const partCount = song.nodeCount || 0;
  const [offset, setOffset] = useState(0);
  const [pressed, setPressed] = useState(false);
  const startRef = useRef({ x: 0, base: 0, moved: false });

  const onTouchStart = useCallback((e) => {
    startRef.current = { x: e.touches[0].clientX, base: offset, moved: false };
    setPressed(true);
  }, [offset]);

  const onTouchMove = useCallback((e) => {
    const dx = e.touches[0].clientX - startRef.current.x;
    if (Math.abs(dx) > 6) { startRef.current.moved = true; setPressed(false); } // a swipe, not a press
    setOffset(Math.max(-REVEAL, Math.min(0, startRef.current.base + dx)));
  }, []);

  const onTouchEnd = useCallback(() => {
    setPressed(false);
    setOffset((o) => (o < -REVEAL / 2 ? -REVEAL : 0));
  }, []);

  const handleOpen = () => {
    if (startRef.current.moved) return;      // it was a swipe, not a tap
    if (offset !== 0) { setOffset(0); return; } // first tap closes the revealed action
    onOpen();
  };

  return (
    <div className={`mp-card${pressed ? ' pressed' : ''}`}>
      <button className="mp-row-delete-action" onClick={onDelete}>Eliminar</button>
      <div
        className="mp-row"
        role="button"
        tabIndex={0}
        style={{ transform: `translateX(${offset}px)` }}
        onClick={handleOpen}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onMouseDown={() => setPressed(true)}
        onMouseUp={() => setPressed(false)}
        onMouseLeave={() => setPressed(false)}
      >
        <ProjectThumbnail nodes={song.previewNodes} links={song.previewLinks} />
        <div className="mp-row-body">
          <div className="mp-row-title">{song.title || 'Sin título'}</div>
          <div className="mp-row-meta">
            {partCount} {partCount === 1 ? 'parte' : 'partes'} · {formatEdited(song.updated_at)}
          </div>
        </div>
        <span className="mp-row-chevron" aria-hidden="true"><IcChevronRight size={15} /></span>
      </div>
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
    return songs.filter((s) => (s.title || 'Sin título').toLowerCase().includes(q));
  }, [songs, query]);

  const openSong = (song) => setState({ activeSong: song, screen: 'canvas' });

  const handleDeleteProject = async (song) => {
    if (!confirm(`¿Eliminar "${song.title || 'este proyecto'}"? No se puede deshacer.`)) return;
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
        <div className="mp-header">
          <h1 className="mp-title">Proyectos</h1>
          <div className="mp-search">
            <span className="mp-search-icon"><IcSearch size={17} /></span>
            <input
              type="text"
              placeholder="Buscar"
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
                <button className="mp-retry-btn" onClick={loadSongs}>Reintentar</button>
              </p>
            )}
            {!state.projectError && filtered.length === 0 && (
              <div className="thread-empty"><p>Aún no hay proyectos.</p></div>
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

      <MobileFab onClick={handleNewProject} pending={creating} title="Nuevo proyecto" aboveTabBar />

      {/* "Perfil" aún no tiene pantalla — la pestaña es solo el chrome de la
          barra inferior del diseño, sin cablear hasta esa fase. */}
      <MobileTabBar active="projects" tabs={TABS} />
    </MobileScreen>
  );
}
