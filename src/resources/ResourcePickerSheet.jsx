import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { loadResourceLibrary } from './resourcesData.js';
import { IcSearch, IcFolder, IcPlus } from '../mobile/icons.jsx';

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

function ResourcePickerRow({ resource, onInsert, onDragStart, onDragMove, onDragEnd }) {
  const [offset, setOffset] = useState(0);
  // Immediate visual feedback on touch — same pressed-state convention as
  // ProjectRow.jsx's own .mp-card.pressed, not a bare CSS :active (which
  // needs a touch handler on the element to even fire reliably on iOS;
  // explicit state sidesteps that instead of depending on it incidentally).
  const [pressed, setPressed] = useState(false);
  const startRef = useRef({ x: 0, y: 0, base: 0, moved: false });
  const pressTimerRef = useRef(null);
  const draggingRef = useRef(false);
  const rowRef = useRef(null);

  const clearPressTimer = () => { clearTimeout(pressTimerRef.current); pressTimerRef.current = null; };
  useEffect(() => () => clearPressTimer(), []);

  // React's onTouchMove is passive, so it can't stop the list from
  // scrolling (or the swipe from fighting the drag) once a drag is live —
  // same fix, same reasoning, as ProjectRow.jsx's own identical listener.
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return undefined;
    const handler = (e) => {
      if (!draggingRef.current) return;
      e.preventDefault();
      const t = e.touches[0];
      onDragMove(t.clientX, t.clientY);
    };
    el.addEventListener('touchmove', handler, { passive: false });
    return () => el.removeEventListener('touchmove', handler);
  }, [onDragMove]);

  const onTouchStart = useCallback((e) => {
    const t = e.touches[0];
    startRef.current = { x: t.clientX, y: t.clientY, base: offset, moved: false };
    setPressed(true);
    clearPressTimer();
    pressTimerRef.current = setTimeout(() => {
      pressTimerRef.current = null;
      draggingRef.current = true;
      startRef.current.moved = true; // whatever follows is never a tap or a swipe
      setOffset(0);
      setPressed(false);
      navigator.vibrate?.(12);
      onDragStart(resource, startRef.current.x, startRef.current.y);
    }, LONG_PRESS_MS);
  }, [offset, onDragStart, resource]);

  const onTouchMove = useCallback((e) => {
    if (draggingRef.current) return; // the native listener above owns a live drag
    const t = e.touches[0];
    const dx = t.clientX - startRef.current.x;
    const dy = t.clientY - startRef.current.y;
    if (Math.hypot(dx, dy) > LONG_PRESS_SLOP) clearPressTimer(); // moving, not holding — no drag
    if (Math.abs(dx) > SWIPE_SLOP && Math.abs(dx) > Math.abs(dy)) { startRef.current.moved = true; setPressed(false); }
    if (startRef.current.moved) setOffset(Math.max(-REVEAL, Math.min(0, startRef.current.base + dx)));
  }, []);

  const finishDrag = useCallback((x, y) => {
    draggingRef.current = false;
    onDragEnd(x, y, resource);
  }, [onDragEnd, resource]);

  const onTouchEnd = useCallback((e) => {
    clearPressTimer();
    setPressed(false);
    if (draggingRef.current) {
      const t = e.changedTouches[0];
      finishDrag(t.clientX, t.clientY);
      return;
    }
    setOffset((o) => (o < -REVEAL / 2 ? -REVEAL : 0));
  }, [finishDrag]);

  const onTouchCancel = useCallback(() => {
    clearPressTimer();
    setPressed(false);
    if (draggingRef.current) finishDrag(null, null);
  }, [finishDrag]);

  const handleTextClick = useCallback(() => {
    if (startRef.current.moved) return; // that was a swipe or a drag, not a tap
    if (offset !== 0) { setOffset(0); return; } // first tap just closes the revealed action
    onInsert(resource);
  }, [offset, onInsert, resource]);

  return (
    <div
      ref={rowRef}
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
// better spent once there were three ways in instead of two).
export default function ResourcePickerSheet({ userId, onInsert, onClose, onDragHoverLine, onDropOnLine }) {
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
    setDrag({ resource, x, y });
  }, []);

  const handleDragMove = useCallback((x, y) => {
    setDrag((d) => (d ? { ...d, x, y } : d));
    onDragHoverLine?.(hitTestLine(x, y));
  }, [onDragHoverLine]);

  const handleDragEnd = useCallback((x, y, resource) => {
    const lineIndex = x != null && y != null ? hitTestLine(x, y) : null;
    if (lineIndex != null) onDropOnLine?.(lineIndex, resource);
    onDragHoverLine?.(null);
    setDrag(null);
  }, [onDragHoverLine, onDropOnLine]);

  return (
    <div className={`baul-sheet-scrim${drag ? ' res-picker-scrim-dragging' : ''}`} onClick={drag ? undefined : onClose}>
      <div className={`baul-sheet res-picker-sheet${drag ? ' res-picker-sheet-shrunk' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="ts-grabber" />

        {drag ? (
          <p className="res-picker-drag-hint">Suelta sobre un verso para añadirlo ahí</p>
        ) : (
          <>
            <div className="res-picker-head">
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
                  onDragMove={handleDragMove}
                  onDragEnd={handleDragEnd}
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
