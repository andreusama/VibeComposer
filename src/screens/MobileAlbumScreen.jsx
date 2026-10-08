import { useState, useEffect, useMemo, useRef } from 'react';
import { setState } from '../state/store.js';
import { loadProjectSummaries, createProject, renameAlbum, deleteAlbum, deleteSong, tracksOfAlbum, moveSongToAlbum, applySongMove, nextTrackPosition, topSortOrder, saveTrackOrder } from './projectsData.js';
import { moveInList, dropIntentAt, sameIntent } from './reorder.js';
import MobileScreen from '../mobile/MobileScreen.jsx';
import MobileFab from '../mobile/MobileFab.jsx';
import ProjectRow, { ProjectThumbnail, formatEdited, dropIdAt, readRowRects } from './ProjectRow.jsx';
import { IcChevronLeft, IcTrash, IcMusicNote } from '../mobile/icons.jsx';

// Height the drop zone occupies at the bottom of the screen (its margin +
// padding + one line of text). Track autoscroll works above this line and
// stops at it, so scrolling a long album never runs through the drop zone.
const DROPZONE_CLEARANCE = 100;

// An album is a container: its tracks are ordinary songs (state.songs whose
// album_id points here), opened in the same editor as a single. The album
// itself carries no content of its own — what makes it "coherent" is derived
// from its tracks, not typed in here.
export default function MobileAlbumScreen({ state, justEntered }) {
  const songs = state.songs || [];
  const albums = state.albums || [];
  const album = albums.find((a) => a.id === state.activeAlbumId) || null;
  const tracks = useMemo(() => (album ? tracksOfAlbum(songs, album.id) : []), [songs, album]);

  const [titleDraft, setTitleDraft] = useState(album?.title || '');
  const [creating, setCreating] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [intent, setIntent] = useState(null);           // where a reorder drop would land
  const [overDropzone, setOverDropzone] = useState(false);
  const dragRectsRef = useRef([]); // every track row's rect, measured once at drag-start

  useEffect(() => {
    if (!justEntered) return;
    loadProjectSummaries().then(({ songs, albums, error }) => setState({ songs, albums, projectError: error, songsLoaded: true }));
  }, [justEntered]);

  // Re-sync the draft when the loaded album arrives/changes, but never
  // clobber what's being typed for the same album.
  useEffect(() => { setTitleDraft(album?.title || ''); }, [album?.id, album?.title]);

  const goBack = () => setState({ activeAlbumId: null, screen: 'home' });

  const commitTitle = async () => {
    if (!album) return;
    const next = titleDraft.trim() || 'Sin título';
    setTitleDraft(next);
    if (next === album.title) return;
    setState({ albums: albums.map((a) => (a.id === album.id ? { ...a, title: next } : a)) });
    const { error } = await renameAlbum(album.id, next);
    if (error) setState({ projectError: error.message });
  };

  const openTrack = (song) => setState({ activeSong: song, screen: 'canvas' }); // activeAlbumId stays set → back returns here

  const handleAddTrack = async () => {
    const userId = state.session?.user?.id;
    if (creating || !userId || !album) return;
    setCreating(true);
    try {
      const nextPosition = nextTrackPosition(songs, album.id);
      const { song, error } = await createProject(userId, 'Sin título', { albumId: album.id, trackPosition: nextPosition });
      if (error || !song) { setState({ projectError: error || 'No se pudo crear' }); return; }
      setState({ songs: [song, ...songs], projectError: null });
      openTrack(song);
    } finally {
      setCreating(false);
    }
  };

  // Where releasing at (x, y) would put the dragged track: out of the album
  // (over the drop zone) or somewhere else in the track order. Rows are
  // measured once at drag-start (dragRectsRef) and offset by the autoscroll
  // delta on each move — see the note on ProjectRow's onDragMove.
  const intentFor = (song, x, y, scrolled = 0) => {
    if (dropIdAt(x, y) === 'single') return { type: 'out' };
    const rows = scrolled ? dragRectsRef.current.map((r) => ({ ...r, top: r.top - scrolled, bottom: r.bottom - scrolled })) : dragRectsRef.current;
    return dropIntentAt(rows, y, { dragId: song.id, canJoinAlbum: false });
  };

  const handleTrackDragMove = (song, x, y, scrolled) => {
    const next = intentFor(song, x, y, scrolled);
    setOverDropzone(next?.type === 'out');
    setIntent((prev) => (sameIntent(prev, next) ? prev : next));
  };

  // Drag a track onto the drop zone to take it out of the album — it becomes
  // a single again, at the top of the projects list — or between two tracks
  // to reorder. Nothing about the song itself changes, only where it sits.
  const handleTrackDragEnd = async (song, x, y, scrolled) => {
    setDragging(false);
    setOverDropzone(false);
    setIntent(null);
    if (x == null) return; // touch cancelled
    const target = intentFor(song, x, y, scrolled);
    if (!target) return;

    const previous = songs;
    if (target.type === 'out') {
      const sortOrder = topSortOrder(songs, albums);
      setState({ songs: applySongMove(songs, song.id, null, { sortOrder }) });
      const { error } = await moveSongToAlbum(song.id, null, { sortOrder });
      if (error) setState({ songs: previous, projectError: error.message });
      return;
    }

    const reordered = moveInList(tracks, song.id, target.id, target.position);
    if (reordered === tracks) return;
    // Tracks are numbered 1..n; only rows whose number changed get written.
    const changes = [];
    reordered.forEach((t, index) => { if ((t.track_position || 0) !== index + 1) changes.push({ id: t.id, value: index + 1 }); });
    const order = Object.fromEntries(changes.map((c) => [c.id, c.value]));
    setState({ songs: songs.map((s) => (s.id in order ? { ...s, track_position: order[s.id] } : s)) });
    const error = await saveTrackOrder(changes);
    if (error) setState({ songs: previous, projectError: error.message });
  };

  const handleDeleteTrack = async (song) => {
    if (!confirm(`¿Eliminar "${song.title || 'esta canción'}"? No se puede deshacer.`)) return;
    const { error } = await deleteSong(song.id);
    if (error) { setState({ projectError: error.message }); return; }
    setState({ songs: songs.filter((s) => s.id !== song.id) });
  };

  const handleDeleteAlbum = async () => {
    if (!album) return;
    if (!confirm(`¿Eliminar el álbum "${album.title || 'sin título'}"? Sus canciones se conservan como sencillos.`)) return;
    const { error } = await deleteAlbum(album.id);
    if (error) { setState({ projectError: error.message }); return; }
    setState({
      albums: albums.filter((a) => a.id !== album.id),
      songs: songs.map((s) => (s.album_id === album.id ? { ...s, album_id: null, track_position: 0 } : s)),
      activeAlbumId: null,
      screen: 'home',
    });
  };

  // Loaded but the album is gone (deleted elsewhere): nothing to show.
  if (state.songsLoaded && !album) {
    return (
      <MobileScreen className="mp-screen">
        <div className="mp-body">
          <div className="thread-empty"><p>Este álbum ya no existe.</p></div>
          <button className="mp-retry-btn" onClick={goBack}>Volver a proyectos</button>
        </div>
      </MobileScreen>
    );
  }

  return (
    <MobileScreen className="mp-screen">
      <div className="mp-body">
        <div className="thread-header">
          <button className="thread-back" onClick={goBack} title="volver a proyectos"><IcChevronLeft size={24} /></button>
          <div className="thread-title-block">
            <input
              className="thread-title-input"
              value={titleDraft}
              placeholder="Sin título"
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
            />
            <div className="mp-row-meta">Álbum · {tracks.length} {tracks.length === 1 ? 'canción' : 'canciones'}</div>
          </div>
        </div>

        {state.projectError && <p className="thread-status thread-status-error">{state.projectError}</p>}

        {!state.songsLoaded ? (
          <div className="mp-loading"><span className="mp-spinner" /></div>
        ) : tracks.length === 0 ? (
          <div className="thread-empty"><p>Este álbum aún no tiene canciones. Toca + para añadir la primera.</p></div>
        ) : (
          tracks.map((song, i) => (
            <ProjectRow
              key={song.id}
              thumb={<ProjectThumbnail nodes={song.previewNodes} links={song.previewLinks} />}
              title={`${i + 1}. ${song.title || 'Sin título'}`}
              meta={`${song.nodeCount || 0} ${(song.nodeCount || 0) === 1 ? 'parte' : 'partes'} · ${formatEdited(song.updated_at)}`}
              onOpen={() => openTrack(song)}
              onDelete={() => handleDeleteTrack(song)}
              rowId={song.id}
              rowKind="track"
              insertMark={intent?.type === 'reorder' && intent.id === song.id ? intent.position : null}
              edgeBottom={DROPZONE_CLEARANCE + 90}
              edgeBottomDead={DROPZONE_CLEARANCE}
              onDragStart={() => { dragRectsRef.current = readRowRects(); setDragging(true); }}
              onDragMove={(x, y, scrolled) => handleTrackDragMove(song, x, y, scrolled)}
              onDragEnd={(x, y, scrolled) => handleTrackDragEnd(song, x, y, scrolled)}
            />
          ))
        )}

        {state.songsLoaded && (
          <button className="mp-album-delete" onClick={handleDeleteAlbum}>
            <IcTrash size={16} /> Eliminar álbum
          </button>
        )}
      </div>

      {dragging ? (
        <div className={`mp-dropzone${overDropzone ? ' active' : ''}`} data-drop-id="single">
          <IcMusicNote size={18} /> Suelta aquí para sacarla del álbum
        </div>
      ) : (
        <MobileFab onClick={handleAddTrack} pending={creating} title="Nueva canción" />
      )}
    </MobileScreen>
  );
}
