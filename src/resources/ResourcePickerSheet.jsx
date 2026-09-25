import { useState, useEffect, useMemo } from 'react';
import { loadResourceLibrary } from './resourcesData.js';
import { IcSearch, IcMuse } from '../mobile/icons.jsx';

// Reached from the note editor's keyboard accessory bar (a text selection
// is already made — see NoteEditorScreen.jsx's handleOpenResourcePicker):
// browse/search the artist's resource library and either insert a
// resource's text in place of the selection, or hand it to the Musa as a
// one-turn reference without touching the lyric. Always loads fresh on
// open — this is a transient picker, not a screen that needs a justEntered
// convention.
export default function ResourcePickerSheet({ userId, onInsert, onAskMusa, onClose }) {
  const [resources, setResources] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!userId) return;
    loadResourceLibrary(userId).then(({ resources }) => { setResources(resources); setLoaded(true); });
  }, [userId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return resources;
    return resources.filter((r) => [r.body, r.origin, ...(r.tags || [])].filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [resources, query]);

  return (
    <div className="baul-sheet-scrim" onClick={onClose}>
      <div className="baul-sheet res-picker-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ts-grabber" />
        <div className="res-picker-body">
          <div className="attach-title">Recursos</div>
          <div className="mp-search res-picker-search">
            <span className="mp-search-icon"><IcSearch size={16} /></span>
            <input type="text" placeholder="Buscar" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>

          <div className="res-picker-list">
            {!loaded && <div className="mp-loading"><span className="mp-spinner" /></div>}
            {loaded && filtered.length === 0 && (
              <p className="res-picker-empty">
                {resources.length === 0 ? 'Aún no tienes recursos guardados.' : 'Nada coincide con la búsqueda.'}
              </p>
            )}
            {filtered.map((r) => (
              <div key={r.id} className="res-picker-row">
                <button className="res-picker-text" onClick={() => onInsert(r)}>{r.body}</button>
                <button className="res-picker-musa" onClick={() => onAskMusa(r)} title="usar como referencia para la musa">
                  <IcMuse size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
