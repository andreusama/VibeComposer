// Earlier wordings of one physical line (line_history). Opened from the
// gutter ⟲ badge. Reuses the ToolsSheet bottom-sheet shell (.ts-* classes).

function relativeTime(iso) {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export default function LineHistorySheet({ entries, currentText, onRestore, onDelete, onClose }) {
  return (
    <div className="ts-backdrop" onClick={onClose}>
      <div className="ts-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ts-grabber" />
        <div className="ts-sub-head"><h2>Line history</h2></div>

        <div className="lh-current">
          <span className="lh-label">now</span>
          <p className="lh-text">{currentText || <em>(empty)</em>}</p>
        </div>

        {entries.length === 0 && <p className="ts-empty">no earlier versions</p>}
        <div className="lh-list">
          {entries.map((entry) => (
            <div className="lh-row" key={entry.id}>
              <span className="lh-label">{relativeTime(entry.created_at)}</span>
              <p className="lh-text">{entry.text || <em>(empty)</em>}</p>
              <div className="lh-row-actions">
                <button onClick={() => onRestore(entry)}>Restore</button>
                <button className="lh-del" onClick={() => onDelete(entry)} title="delete this version">✕</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
