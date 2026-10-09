import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { loadResourceLibrary } from './resourcesData.js';
import { IcSearch, IcFolder, IcPlus } from '../mobile/icons.jsx';
import useSheetDismissSwipe from '../mobile/useSheetDismissSwipe.js';

// Swipe-left-to-reveal-insert, same two-step "swipe reveals, tap commits"
// mechanic as ProjectRow.jsx's own delete action (REVEAL/slop/snap values
// match it exactly, on purpose — one swipe vocabulary for the whole app,
// not a second one invented here). Long-press-and-drag (same LONG_PRESS_MS/
// SLOP as ProjectRow's own reorder drag) is the third way in, for dropping
// a resource onto a specific line instead of wherever the cursor is.
const REVEAL = 84; // px of the "Añadir" action revealed on a full swipe-left
const SWIPE_SLOP = 6; // px of horizontal travel before a touch commits to being a swipe, not a tap
const LONG_PRESS_MS = 380;
const LONG_PRESS_SLOP = 8;

// A row's job ends at "a long-press happened, here's the resource and
// where it started" — it does NOT track the rest of the drag itself.
// Earlier it did (a native touchmove listener on the row, finishing the
// drag from the row's own onTouchEnd), which worked in every test here
// because testing never kept one real finger down across the state change
// that follows onDragStart: the moment a drag begins, the PARENT swaps its
// whole rendered content (sheet shrinks to a strip, the row list —
// including this row — unmounts). A touch sequence whose origin element
// just left the DOM stops being delivered to it; on a real device this
// read as "drag picks up, then the sheet just freezes" (reported
// 2026-10-08), not an error, because nothing threw — the events simply had
// nowhere left to go. The fix is below, in ResourcePickerSheet itself: it
// owns the live drag via document-level listeners from the moment
// onDragStart fires, so it doesn't matter that the row that started it is
// gone a frame later.
function ResourcePickerRow({ resource, onInsert, onDragStart }) {
  const [offset, setOffset] = useState(0);
  // Immediate visual feedback on touch — same pressed-state convention as
  // ProjectRow.jsx's own .mp-card.pressed, not a bare CSS :active (which
  // needs a touch handler on the element to even fire reliably on iOS;
  // explicit state sidesteps that instead of depending on it incidentally).
  const [pressed, setPressed] = useState(false);
  const startRef = useRef({ x: 0, y: 0, base: 0, moved: false });
  const pressTimerRef = useRef(null);

  const clearPressTimer = () => { clearTimeout(pressTimerRef.current); pressTimerRef.current = null; };
  useEffect(() => () => clearPressTimer(), []);

  const onTouchStart = useCallback((e) => {
    const t = e.touches[0];
    startRef.current = { x: t.clientX, y: t.clientY, base: offset, moved: false };
    setPressed(true);
    clearPressTimer();
    pressTimerRef.current = setTimeout(() => {
      pressTimerRef.current = null;
      startRef.current.moved = true; // whatever follows is never a tap or a swipe
      setOffset(0);
      setPressed(false);
      navigator.vibrate?.(12);
      onDragStart(resource, startRef.current.x, startRef.current.y);
    }, LONG_PRESS_MS);
  }, [offset, onDragStart, resource]);

  const onTouchMove = useCallback((e) => {
    const t = e.touches[0];
    const dx = t.clientX - startRef.current.x;
    const dy = t.clientY - startRef.current.y;
    if (Math.hypot(dx, dy) > LONG_PRESS_SLOP) clearPressTimer(); // moving, not holding — no drag
    if (Math.abs(dx) > SWIPE_SLOP && Math.abs(dx) > Math.abs(dy)) { startRef.current.moved = true; setPressed(false); }
    if (startRef.current.moved) setOffset(Math.max(-REVEAL, Math.min(0, startRef.current.base + dx)));
  }, []);

  const onTouchEnd = useCallback(() => {
    clearPressTimer();
    setPressed(false);
    setOffset((o) => (o < -REVEAL / 2 ? -REVEAL : 0));
  }, []);

  const onTouchCancel = useCallback(() => {
    clearPressTimer();
    setPressed(false);
  }, []);

  const handleTextClick = useCallback(() => {
    if (startRef.current.moved) return; // that was a swipe or a drag, not a tap
    if (offset !== 0) { setOffset(0); return; } // first tap just closes the revealed action
    onInsert(resource);
  }, [offset, onInsert, resource]);

  return (
    <div
      className={`res-picker-row${pressed ? ' pressed' : ''}`}
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
  // { resource, x, y } while a long-press has lifted a resource to drag it
  // onto a line; null the rest of the time. x/y are viewport coordinates,
  // used both to position the floating pill and (via elementFromPoint) to
  // hit-test which line is underneath — the drop target lives in a
  // different component tree (NoteEditorScreen) than this sheet, so a DOM
  // query is what bridges them, same cross-tree hit-testing ProjectRow.jsx
  // already relies on for its own reorder drag.
  const [drag, setDrag] = useState(null);
  // Mirrors `drag`, read synchronously inside the document-level listener
  // below — that listener is attached once (empty deps) and must never act
  // on a stale closure over `drag` from whatever render set it up.
  const dragRef = useRef(null);

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

  const hitTestLine = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const lineEl = el?.closest('[data-line-index]');
    return lineEl ? Number(lineEl.dataset.lineIndex) : null;
  };

  const handleDragStart = useCallback((resource, x, y) => {
    const next = { resource, x, y };
    dragRef.current = next;
    setDrag(next);
    // Lets NoteEditorScreen disable pointer-events on its <textarea>s for
    // the drag's whole duration — see ChordStrumSheet.jsx's identical fix
    // (same bug: a real device's native text-selection handling can claim
    // an in-progress touch the moment it crosses a textarea, freezing the
    // drag with no JS preventDefault able to undo it after the fact).
    onDragActiveChange?.(true);
  }, [onDragActiveChange]);

  const endDrag = useCallback((x, y) => {
    const resource = dragRef.current?.resource;
    const lineIndex = x != null && y != null ? hitTestLine(x, y) : null;
    if (lineIndex != null && resource) onDropOnLine?.(lineIndex, resource);
    onDragHoverLine?.(null);
    onDragActiveChange?.(false);
    dragRef.current = null;
    setDrag(null);
  }, [onDragHoverLine, onDropOnLine, onDragActiveChange]);

  // Owns the live drag from the sheet's own root, which is the one thing
  // in this tree guaranteed to stay mounted for the drag's whole duration
  // (unlike the row that started it — see ResourcePickerRow's comment).
  // Attached once; gated on dragRef so it's a no-op whenever nothing is
  // actually being dragged, rather than attached/detached per drag.
  useEffect(() => {
    const handleMove = (e) => {
      if (!dragRef.current) return;
      e.preventDefault();
      const t = e.touches[0];
      if (!t) return;
      const next = { ...dragRef.current, x: t.clientX, y: t.clientY };
      dragRef.current = next;
      setDrag(next);
      onDragHoverLine?.(hitTestLine(t.clientX, t.clientY));
    };
    const handleEnd = (e) => {
      if (!dragRef.current) return;
      const t = e.changedTouches[0];
      endDrag(t?.clientX ?? null, t?.clientY ?? null);
    };
    const handleCancel = () => {
      if (dragRef.current) endDrag(null, null);
    };
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd);
    document.addEventListener('touchcancel', handleCancel);
    return () => {
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleEnd);
      document.removeEventListener('touchcancel', handleCancel);
    };
  }, [endDrag, onDragHoverLine]);

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
        <div className="res-picker-drag-pill" style={{ left: drag.x, top: drag.y }}>
          {drag.resource.body.length > 70 ? `${drag.resource.body.slice(0, 70)}…` : drag.resource.body}
        </div>
      )}
    </div>
  );
}
