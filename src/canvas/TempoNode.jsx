import { useState, useCallback } from 'react';
import { Handle, Position, NodeResizer } from '@xyflow/react';

const HANDLE_STYLE = { width: 10, height: 10, background: '#B8842A', border: '2px solid #fff' };

// A tempo node is a tool, not song content — like the vibe-compose node it
// never gets a DB row of its own, so it's local-only React state. What it
// carries (a bpm number) is only meaningful plugged into a chord progression,
// and disappears with it if the canvas reloads before it's wired up again.
export default function TempoNode({ id, data, selected }) {
  const { bpm = 120, onBpmChange, onDeleted } = data;
  const [value, setValue] = useState(bpm);

  const commit = useCallback((raw) => {
    const next = Math.min(300, Math.max(20, Math.round(Number(raw)) || 120));
    setValue(next);
    onBpmChange?.(id, next);
  }, [id, onBpmChange]);

  const handleDelete = useCallback((e) => {
    e.stopPropagation();
    onDeleted?.(id);
  }, [id, onDeleted]);

  return (
    <div className={`canvas-tempo${selected ? ' selected' : ''}`}>
      <NodeResizer minWidth={140} minHeight={100} isVisible={selected} />
      <Handle type="source" position={Position.Right} id="tempo-out" style={HANDLE_STYLE} title="drag onto a chord progression to set its tempo" />
      <button className="tempo-delete nodrag" onClick={handleDelete} title="delete tempo">✕</button>
      <span className="tempo-eyebrow">Tempo</span>
      <div className="tempo-face">
        {/* Pure CSS pulse, timed off the bpm via a custom property — no rAF
            loop, the browser's own animation clock stays accurate and free. */}
        <span className="tempo-dot" style={{ '--bpm': value }} />
        <input
          className="tempo-bpm nodrag"
          type="number"
          min="20"
          max="300"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
        />
        <span className="tempo-unit">bpm</span>
      </div>
    </div>
  );
}
