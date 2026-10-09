import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { loadResourceLibrary } from './resourcesData.js';
import { IcSearch, IcFolder, IcPlus } from '../mobile/icons.jsx';
import useSheetDismissSwipe from '../mobile/useSheetDismissSwipe.js';
import useLongPressDrag from '../mobile/useLongPressDrag.js';
import useLineDragDrop from '../mobile/useLineDragDrop.js';
import LineDragPill from '../mobile/LineDragPill.jsx';

// Swipe-left-to-reveal-insert, same two-step "swipe reveals, tap commits"
// mechanic as ProjectRow.jsx's own delete action (REVEAL/slop values match
// it exactly, on purpose — one swipe vocabulary for the whole app, not a
// second one invented here). Long-press-and-drag (useLongPressDrag.js) is
// the third way in, for dropping a resource onto a specific line instead of
// wherever the cursor is.
const REVEAL = 84; // px of the "Añadir" action revealed on a full swipe-left
const SWIPE_SLOP = 6; // px of horizontal travel before a touch commits to being a swipe, not a tap

// A row's job ends at "a long-press happened, here's the resource and
// where it started" — it does NOT track the rest of the drag itself (see
// useLongPressDrag.js). Earlier it did (a native touchmove listener on the
// row, finishing the drag from the row's own onTouchEnd), which worked in
// every test here because testing never kept one real finger down across
// the state change that follows onDragStart: the moment a drag begins, the
// PARENT swaps its whole rendered content (sheet shrinks to a strip, the
// row list — including this row — unmounts). A touch sequence whose origin
// element just left the DOM stops being delivered to it; on a real device
// this read as "drag picks up, then the sheet just freezes" (reported
// 2026-10-08), not an error, because nothing threw — the events simply had
// nowhere left to go. The fix is in ResourcePickerSheet itself (via
// useLineDragDrop.js): it owns the live drag via document-level listeners
// from the moment onDragStart fires, so it doesn't matter that the row that
// started it is gone a frame later.
//
// This row still owns its OWN swipe-to-reveal gesture locally (useLongPressDrag
// only replaces the long-press-timing half) — `lp.move` is composed into the
// same onTouchMove that tracks the reveal offset, since both read the same
// live touch point. `swipedRef` is this row's own "that wasn't a tap" flag
// for the swipe case specifically — lp.moved() only answers for the DRAG
// case (it's lp's own internal flag, set only when its long-press timer
// actually fires), so a swipe that never reached the timer needs its own.
function ResourcePickerRow({ resource, onInsert, onDragStart }) {
  const [offset, setOffset] = useState(0);
  const baseRef = useRef(0);
  const swipedRef = useRef(false);
  const lp = useLongPressDrag({ onDragStart: (res, x, y) => { setOffset(0); onDragStart(res, x, y); } });

  const onTouchStart = useCallback((e) => {
    const t = e.touches[0];
    baseRef.current = offset;
    swipedRef.current = false;
    lp.start(t.clientX, t.clientY, resource);
  }, [offset, lp, resource]);

  const onTouchMove = useCallback((e) => {
    const t = e.touches[0];
    const { x: startX, y: startY } = lp.startPoint();
    lp.move(t.clientX, t.clientY); // cancels the long-press timer past LONG_PRESS_SLOP
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (Math.abs(dx) > SWIPE_SLOP && Math.abs(dx) > Math.abs(dy)) { swipedRef.current = true; lp.cancel(); }
    if (swipedRef.current) setOffset(Math.max(-REVEAL, Math.min(0, baseRef.current + dx)));
  }, [lp]);

  const onTouchEnd = useCallback(() => {
    lp.end();
    setOffset((o) => (o < -REVEAL / 2 ? -REVEAL : 0));
  }, [lp]);

  const onTouchCancel = useCallback(() => { lp.end(); }, [lp]);

  const handleTextClick = useCallback(() => {
    if (lp.moved() || swipedRef.current) return; // that was a swipe or a drag, not a tap
    if (offset !== 0) { setOffset(0); return; } // first tap just closes the revealed action
    onInsert(resource);
  }, [lp, offset, onInsert, resource]);

  return (
    <div
      className={`res-picker-row${lp.pressed ? ' pressed' : ''}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
    >
      <button className="res-picker-row-add-action" onClick={() => { setOffset(0); onInsert(resource); }}>
        <IcPlus size={18} /> Añadir
      </button>
      <div className="res-picker-row-slide" style={{ transform: `translateX(${offset}px)` }}>
        <button className="res-picker-text" onClick={handleTextClick}>{resource.body}</button>
      </div>
    </div>
  );
}

// Reached from the note editor's keyboard accessory bar: browse/search/
// filter the artist's resource library and either insert a resource's text
// (with a selection: in its place; with just a caret: at the cursor — see
// NoteEditorScreen.jsx's handleOpenResourcePicker) or drag it onto a
// specific line (see onDragStart et al. below). Always loads fresh on
// open — this is a transient picker, not a screen that needs a justEntered
// convention.
//
// Redesigned 2026-10-08: was a flat, low-contrast list with no folder
// filter — same raised-card look + sticky header + folder chips as the main
// Recursos library screen now (MobileResourcesScreen.jsx). Swipe-to-insert
// and drag-to-a-specific-line added same day; the "hand to the Musa as a
// reference" action removed the same day too (per-row real estate was
// better spent once there were three ways in instead of two). Drag
// ownership moved from the row to this component later the same day — see
// ResourcePickerRow's own comment for why.
export default function ResourcePickerSheet({ userId, onInsert, onClose, onDragHoverLine, onDropOnLine, onDragActiveChange }) {
  const [resources, setResources] = useState([]);
  const [folders, setFolders] = useState([]);
  const [membership, setMembership] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [activeFolderId, setActiveFolderId] = useState(null); // null = "Todos"

  // The live drag (document-level move/end listeners, hover, drop) is
  // identical to ChordStrumSheet's own — see useLineDragDrop.js. A resource
  // drop only needs the line it landed on (unlike a chord, which needs the
  // word), so onDropOnLine is handed (x, y, resource) and resolves the line
  // itself via the same lineIndexFromPoint the hook already uses for hover.
  const { drag, beginDrag: handleDragStart } = useLineDragDrop({
    onDragHoverLine,
    onDragActiveChange,
    onDrop: onDropOnLine,
  });

  // Drag the sheet itself down to dismiss it — same closing gesture every
  // bottom sheet in the app should eventually get (this is the first),
  // next to the existing tap-the-scrim close. Disabled while a resource is
  // being dragged onto a line: that's a different gesture living on the
  // same sheet, and the two must never both react to one finger.
  const { translateY: dismissY, handlers: dismissHandlers } = useSheetDismissSwipe({ onClose, enabled: !drag });

  useEffect(() => {
    if (!userId) return;
    loadResourceLibrary(userId).then(({ resources, folders, membership }) => {
      setResources(resources);
      setFolders(folders);
      setMembership(membership);
      setLoaded(true);
    });
  }, [userId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return resources.filter((r) => {
      if (activeFolderId && !(membership[r.id] || []).includes(activeFolderId)) return false;
      if (!q) return true;
      return [r.body, r.origin, ...(r.tags || [])].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
  }, [resources, membership, activeFolderId, query]);

  return (
    <div className={`baul-sheet-scrim${drag ? ' res-picker-scrim-dragging' : ''}`} onClick={drag ? undefined : onClose}>
      <div
        className={`baul-sheet res-picker-sheet${drag ? ' res-picker-sheet-shrunk' : ''}`}
        style={dismissY ? { transform: `translateY(${dismissY}px)`, transition: 'none' } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ts-grabber" {...dismissHandlers} />

        {drag ? (
          <p className="res-picker-drag-hint">Suelta sobre un verso para añadirlo ahí</p>
        ) : (
          <>
            <div className="res-picker-head" {...dismissHandlers}>
              <div className="attach-title">Recursos</div>
              <div className="mp-search res-picker-search">
                <span className="mp-search-icon"><IcSearch size={16} /></span>
                <input type="text" placeholder="Buscar" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>

              {folders.length > 0 && (
                <div className="res-chip-row res-folder-filter">
                  <button className={`res-chip${activeFolderId === null ? ' res-chip-active' : ''}`} onClick={() => setActiveFolderId(null)}>Todos</button>
                  {folders.map((f) => (
                    <button
                      key={f.id}
                      className={`res-chip${activeFolderId === f.id ? ' res-chip-active' : ''}`}
                      onClick={() => setActiveFolderId(activeFolderId === f.id ? null : f.id)}
                    >
                      <IcFolder size={12} /> {f.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="res-picker-list">
              {!loaded && <div className="mp-loading"><span className="mp-spinner" /></div>}
              {loaded && filtered.length === 0 && (
                <p className="res-picker-empty">
                  {resources.length === 0 ? 'Aún no tienes recursos guardados.' : 'Nada coincide con esta búsqueda o carpeta.'}
                </p>
              )}
              {filtered.map((r) => (
                <ResourcePickerRow
                  key={r.id}
                  resource={r}
                  onInsert={onInsert}
                  onDragStart={handleDragStart}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {drag && (
        <LineDragPill x={drag.x} y={drag.y}>
          {drag.payload.body.length > 70 ? `${drag.payload.body.slice(0, 70)}…` : drag.payload.body}
        </LineDragPill>
      )}
    </div>
  );
}
