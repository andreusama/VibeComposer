import { useState, useEffect, useMemo, useRef } from 'react';
import { setState } from '../state/store.js';
import { loadProjectSummaries, createProject, createAlbum, deleteSong, deleteAlbum, tracksOfAlbum, moveSongToAlbum, applySongMove, nextTrackPosition, topSortOrder, saveProjectOrder } from './projectsData.js';
import { moveInList, dropIntentAt, sameIntent, compareProjects } from './reorder.js';
import MobileScreen from '../mobile/MobileScreen.jsx';
import MobileFab from '../mobile/MobileFab.jsx';
import ProjectRow, { ProjectThumbnail, formatEdited, readRowRects } from './ProjectRow.jsx';
import { IcSearch, IcAlbum, IcMusicNote } from '../mobile/icons.jsx';

// The FAB no longer creates blindly: a project is either a single (one
// independent song) or an album (a container of tracks that grows a shared
// identity), and that's a choice the writer makes up front.
function NewProjectSheet({ pending, onPick, onClose }) {
  return (
    <div className="baul-sheet-scrim" onClick={pending ? undefined : onClose}>
      <div className="baul-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ts-grabber" />
        <div className="baul-sheet-body">
          <div className="attach-title">Nuevo proyecto</div>
          <p className="attach-sub">Un sencillo es una canción independiente. Un álbum agrupa canciones que comparten un hilo.</p>
          <button className="attach-option" onClick={() => onPick('single')} disabled={pending}>
            <span className="aic aic-thread"><IcMusicNote size={18} /></span>
            <span className="tt">Sencillo</span>
          </button>
          <button className="attach-option" onClick={() => onPick('album')} disabled={pending}>
            <span className="aic aic-amber"><IcAlbum size={18} /></span>
            <span className="tt">Álbum</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function AlbumThumbnail() {
  return <div className="mp-thumb mp-thumb-album"><IcAlbum size={22} /></div>;
}

export default function MobileProjectsScreen({ state, justEntered }) {
  const songs = state.songs || [];
  const albums = state.albums || [];
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dragging, setDragging] = useState(null); // kind of the item being dragged, or null
  const [intent, setIntent] = useState(null); // what releasing right now would do
  const dragRectsRef = useRef([]); // every row's rect, measured once at drag-start

  const loadSongs = () => {
    loadProjectSummaries().then(({ songs, albums, error }) => setState({ songs, albums, projectError: error, songsLoaded: true }));
  };

  useEffect(() => {
    if (!justEntered) return;
    loadSongs();
  }, [justEntered]);

  // One merged list, in the manual order set by dragging (most-recently-touched
  // first until anything has been dragged): every single (a song with
  // no album) plus every album. An album's tracks don't appear at the top
  // level — they live inside it. An album counts as edited whenever any of
  // its tracks was, not just when it was renamed.
  const items = useMemo(() => {
    const singles = songs.filter((s) => !s.album_id).map((song) => ({ kind: 'single', id: song.id, title: song.title, updated: song.updated_at, sortOrder: song.sort_order, song }));
    const albumItems = albums.map((album) => {
      const tracks = tracksOfAlbum(songs, album.id);
      const updated = [album.updated_at, ...tracks.map((t) => t.updated_at)].sort().pop();
      return { kind: 'album', id: album.id, title: album.title, updated, sortOrder: album.sort_order, album, trackCount: tracks.length };
    });
    return [...singles, ...albumItems].sort(compareProjects);
  }, [songs, albums]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => (it.title || 'Sin título').toLowerCase().includes(q));
  }, [items, query]);

  const openSong = (song) => setState({ activeSong: song, activeAlbumId: null, screen: 'canvas' });
  const openAlbum = (album) => setState({ activeAlbumId: album.id, screen: 'album' });

  const handleDelete = async (item) => {
    if (item.kind === 'single') {
      if (!confirm(`¿Eliminar "${item.title || 'este proyecto'}"? No se puede deshacer.`)) return;
      const { error } = await deleteSong(item.id);
      if (error) { setState({ projectError: error.message }); return; }
      setState({ songs: songs.filter((s) => s.id !== item.id) });
      return;
    }
    // Deleting an album only removes the container — its songs survive as
    // singles (songs.album_id is `on delete set null`).
    if (!confirm(`¿Eliminar el álbum "${item.title || 'sin título'}"? Sus canciones se conservan como sencillos.`)) return;
    const { error } = await deleteAlbum(item.id);
    if (error) { setState({ projectError: error.message }); return; }
    setState({
      albums: albums.filter((a) => a.id !== item.id),
      songs: songs.map((s) => (s.album_id === item.id ? { ...s, album_id: null, track_position: 0 } : s)),
    });
  };

  // Reordering is only meaningful on the full list — with a search filter
  // applied, "before/after" would be relative to a partial view.
  const canReorder = !query.trim();

  // The list doesn't reflow while dragging (insertMark/drop-active are pure
  // box-shadow/outline, see style.css) — only autoscroll moves anything, and
  // that's a uniform viewport shift. So one measurement at drag-start plus
  // the per-frame scroll delta (from ProjectRow) is exactly as accurate as
  // re-measuring, without a DOM query + layout read on every frame.
  const intentFor = (item, x, y, scrolled = 0) => {
    const rows = scrolled ? dragRectsRef.current.map((r) => ({ ...r, top: r.top - scrolled, bottom: r.bottom - scrolled })) : dragRectsRef.current;
    const next = dropIntentAt(rows, y, { dragId: item.id, canJoinAlbum: item.kind === 'single' });
    if (next?.type === 'reorder' && !canReorder) return null;
    return next;
  };

  const handleDragMove = (item, x, y, scrolled) => {
    const next = intentFor(item, x, y, scrolled);
    setIntent((prev) => (sameIntent(prev, next) ? prev : next));
  };

  // Persists the dragged item's new place in the list. Every project gets its
  // list index as its sort_order, but only rows whose value changed are written.
  const applyReorder = async (item, target) => {
    const reordered = moveInList(items, item.id, target.id, target.position);
    if (reordered === items) return;
    const changes = [];
    reordered.forEach((it, index) => { if ((it.sortOrder || 0) !== index) changes.push({ kind: it.kind, id: it.id, value: index }); });
    const order = Object.fromEntries(changes.map((c) => [c.id, c.value]));
    const previous = { songs, albums };
    setState({
      songs: songs.map((s) => (s.id in order ? { ...s, sort_order: order[s.id] } : s)),
      albums: albums.map((a) => (a.id in order ? { ...a, sort_order: order[a.id] } : a)),
    });
    const error = await saveProjectOrder(changes);
    if (error) setState({ ...previous, projectError: error.message });
  };

  // Drag a single onto an album to file it there as its last track; drag
  // anything between rows to reorder it.
  const handleDragEnd = async (item, x, y, scrolled) => {
    setDragging(null);
    setIntent(null);
    if (x == null) return; // touch cancelled
    const target = intentFor(item, x, y, scrolled);
    if (!target) return;
    if (target.type === 'reorder') { await applyReorder(item, target); return; }

    const previous = songs;
    const position = nextTrackPosition(songs, target.id);
    setState({ songs: applySongMove(songs, item.id, target.id, { trackPosition: position }) });
    const { error } = await moveSongToAlbum(item.id, target.id, { trackPosition: position });
    if (error) setState({ songs: previous, projectError: error.message });
  };

  // Everything a row needs to take part in dragging, as either the dragged
  // card or a target. Albums are draggable too (reorder only); only a single
  // can be filed into one.
  const dragProps = (it) => ({
    rowId: it.id,
    rowKind: it.kind,
    dropReady: dragging === 'single' && it.kind === 'album',
    dropActive: intent?.type === 'into' && intent.id === it.id,
    insertMark: intent?.type === 'reorder' && intent.id === it.id ? intent.position : null,
    onDragStart: () => { dragRectsRef.current = readRowRects(); setDragging(it.kind); },
    onDragMove: (x, y, scrolled) => handleDragMove(it, x, y, scrolled),
    onDragEnd: (x, y, scrolled) => handleDragEnd(it, x, y, scrolled),
  });

  const handlePick = async (kind) => {
    const userId = state.session?.user?.id;
    if (creating || !userId) return;
    setCreating(true);
    try {
      if (kind === 'single') {
        const { song, error } = await createProject(userId, 'Sin título', { sortOrder: topSortOrder(songs, albums) });
        if (error || !song) { setState({ projectError: error || 'No se pudo crear' }); return; }
        setState({ songs: [song, ...songs], projectError: null });
        setSheetOpen(false);
        openSong(song);
      } else {
        const { album, error } = await createAlbum(userId, 'Sin título', topSortOrder(songs, albums));
        if (error || !album) { setState({ projectError: error || 'No se pudo crear' }); return; }
        setState({ albums: [album, ...albums], projectError: null });
        setSheetOpen(false);
        openAlbum(album);
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <MobileScreen className="mp-screen" fixed={false}>
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
            {filtered.map((it) => it.kind === 'album' ? (
              <ProjectRow
                key={`album-${it.id}`}
                thumb={<AlbumThumbnail />}
                title={it.title}
                meta={`Álbum · ${it.trackCount} ${it.trackCount === 1 ? 'canción' : 'canciones'} · ${formatEdited(it.updated)}`}
                onOpen={() => openAlbum(it.album)}
                onDelete={() => handleDelete(it)}
                {...dragProps(it)}
              />
            ) : (
              <ProjectRow
                key={`song-${it.id}`}
                thumb={<ProjectThumbnail nodes={it.song.previewNodes} links={it.song.previewLinks} />}
                title={it.title}
                meta={`Sencillo · ${it.song.nodeCount || 0} ${(it.song.nodeCount || 0) === 1 ? 'parte' : 'partes'} · ${formatEdited(it.updated)}`}
                onOpen={() => openSong(it.song)}
                onDelete={() => handleDelete(it)}
                {...dragProps(it)}
              />
            ))}
          </>
        )}
      </div>

      <MobileFab onClick={() => setSheetOpen(true)} pending={creating} title="Nuevo proyecto" aboveTabBar />

      {sheetOpen && <NewProjectSheet pending={creating} onPick={handlePick} onClose={() => setSheetOpen(false)} />}
    </MobileScreen>
  );
}
