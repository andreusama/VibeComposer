// Earlier wordings of one physical line (line_history). Opened from the
// gutter history badge. Reuses the ToolsSheet bottom-sheet shell (.ts-* classes).
import { IcClose } from './icons.jsx';

function relativeTime(iso) {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'ahora mismo';
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  const days = Math.round(hrs / 24);
  return `hace ${days} d`;
}

export default function LineHistorySheet({ entries, currentText, onRestore, onDelete, onClose }) {
  return (
    <div className="ts-backdrop" onClick={onClose}>
      <div className="ts-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ts-grabber" />
        <div className="ts-sub-head"><h2>Historial del verso</h2></div>

        <div className="lh-current">
          <span className="lh-label">ahora</span>
          <p className="lh-text">{currentText || <em>(vacío)</em>}</p>
        </div>

        {entries.length === 0 && <p className="ts-empty">no hay versiones anteriores</p>}
        <div className="lh-list">
          {entries.map((entry) => (
            <div className="lh-row" key={entry.id}>
              <span className="lh-label">{relativeTime(entry.created_at)}</span>
              <p className="lh-text">{entry.text || <em>(vacío)</em>}</p>
              <div className="lh-row-actions">
                <button onClick={() => onRestore(entry)}>Restaurar</button>
                <button className="lh-del" onClick={() => onDelete(entry)} title="borrar esta versión"><IcClose size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
