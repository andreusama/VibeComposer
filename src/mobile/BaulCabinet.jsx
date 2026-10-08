import { useState, useEffect, useCallback, useMemo } from 'react';
import { loadBaulItems, getBaulItemUrls } from '../canvas/baulItemsData.js';
import { IcClose, IcPlus, IcNote, IcPaperclip } from './icons.jsx';

const SHELF_SIZE = 3;   // tiles per shelf
const MIN_SHELVES = 3;  // an empty cabinet should still look like a cabinet

// The Baúl's glass cabinet: a shelf display of everything the artist has put
// in for this song — the notes they wrote, the photos of their notebook, the
// PDFs. It shows ONLY those inputs, never what the Baúl extracted from them
// (the ADN stays a black box on purpose). The last tile is always "Añadir",
// which opens the existing add sheet.
//
// Rendered as a pane that lives to the left of the song screen (see
// useCabinetSwipe); `open` is only used to refresh its contents each time it
// is brought into view.
export default function BaulCabinet({ songId, open, refreshKey, onAdd, onClose }) {
  const [items, setItems] = useState([]);
  const [urls, setUrls] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [viewing, setViewing] = useState(null);

  const reload = useCallback(async () => {
    const { data } = await loadBaulItems(songId);
    const list = data || [];
    setItems(list);
    setLoaded(true);
    setUrls(await getBaulItemUrls(list));
  }, [songId]);

  // Fresh contents every time it's brought into view, and after something is
  // added from anywhere (refreshKey).
  useEffect(() => { if (open) reload(); }, [open, refreshKey, reload]);

  // Shelves: the items, then the "Añadir" tile, packed SHELF_SIZE to a shelf,
  // padded with empty shelves so the cabinet never collapses.
  const shelves = useMemo(() => {
    const tiles = [...items.map((item) => ({ item })), { add: true }];
    const rows = [];
    for (let i = 0; i < tiles.length; i += SHELF_SIZE) rows.push(tiles.slice(i, i + SHELF_SIZE));
    while (rows.length < MIN_SHELVES) rows.push([]);
    return rows;
  }, [items]);

  return (
    <div className="cab-screen">
      <div className="cab-head">
        <div>
          <div className="cab-title">Baúl</div>
          <div className="cab-sub">Lo que has guardado para esta canción</div>
        </div>
        <button className="cab-close" onClick={onClose} title="cerrar"><IcClose size={18} /></button>
      </div>

      <div className="cab-body">
        <div className="cab-glass">
          {shelves.map((row, r) => (
            <div className="cab-shelf" key={r}>
              {row.map((tile, i) => tile.add ? (
                <button key="add" className="cab-tile cab-add" onClick={onAdd}>
                  <IcPlus size={22} />
                  <span>Añadir</span>
                </button>
              ) : (
                <CabinetItem key={tile.item.id} item={tile.item} url={urls[tile.item.storage_path]} tilt={(r * SHELF_SIZE + i) % 3} onOpen={() => setViewing(tile.item)} />
              ))}
              <div className="cab-plank" />
            </div>
          ))}
          <div className="cab-shine" />
        </div>

        {loaded && items.length === 0 && (
          <p className="cab-empty">Aún no hay nada. Guarda aquí notas, fotos de tu libreta o PDFs — lo que te inspira para esta canción.</p>
        )}
      </div>

      {viewing && <CabinetViewer item={viewing} url={urls[viewing.storage_path]} onClose={() => setViewing(null)} />}
    </div>
  );
}

function CabinetItem({ item, url, tilt, onOpen }) {
  if (item.kind === 'note') {
    return (
      <button className={`cab-tile cab-note cab-tilt-${tilt}`} onClick={onOpen}>
        <span className="cab-note-text">{item.text_content}</span>
      </button>
    );
  }
  if (item.kind === 'image') {
    return (
      <button className={`cab-tile cab-photo cab-tilt-${tilt}`} onClick={onOpen}>
        {url ? <img src={url} alt={item.file_name || 'foto'} /> : <span className="cab-photo-pending"><IcNote size={20} /></span>}
      </button>
    );
  }
  return (
    <button className={`cab-tile cab-doc cab-tilt-${tilt}`} onClick={onOpen}>
      <IcPaperclip size={22} />
      <span className="cab-doc-name">{item.file_name || 'documento'}</span>
    </button>
  );
}

function CabinetViewer({ item, url, onClose }) {
  return (
    <div className="cab-viewer" onClick={onClose}>
      <div className="cab-viewer-card" onClick={(e) => e.stopPropagation()}>
        <button className="cab-close cab-viewer-close" onClick={onClose} title="cerrar"><IcClose size={18} /></button>
        {item.kind === 'note' && <p className="cab-viewer-text">{item.text_content}</p>}
        {item.kind === 'image' && (url ? <img className="cab-viewer-img" src={url} alt={item.file_name || 'foto'} /> : <p className="cab-viewer-text">Cargando…</p>)}
        {item.kind === 'document' && (
          <>
            <p className="cab-viewer-text">{item.file_name || 'documento'}</p>
            {url && <a className="cab-viewer-open" href={url} target="_blank" rel="noopener noreferrer">Abrir PDF</a>}
          </>
        )}
        <div className="cab-viewer-date">{new Date(item.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
      </div>
    </div>
  );
}
