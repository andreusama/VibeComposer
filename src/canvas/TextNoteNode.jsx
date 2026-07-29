import { useState, useEffect, useCallback, useRef } from 'react';
import { Handle, Position, NodeResizer } from '@xyflow/react';
import { SECTION_TYPES, saveNoteType, saveNoteText, saveNotePosition, deleteNote } from './canvasData.js';

// Set explicitly rather than relying on the base stylesheet's 6px default,
// which wasn't reliably applying — this guarantees a small, predictable dot
// regardless of whatever was overriding it.
const HANDLE_STYLE = { width: 10, height: 10, background: '#1a1a1a', border: '2px solid #fff' };
// The chord-assignment plug is its own dedicated handle, visually distinct
// (gold, bottom-center) from the left/right main-thread connectors — sharing
// the same handles for two different meanings (note-to-note chaining vs.
// chords-to-note assignment) was exactly what made connections feel mixed up.
const CHORD_HANDLE_STYLE = { width: 12, height: 12, background: '#c9a86a', border: '2px solid #fff' };

export default function TextNoteNode({ id, data, selected }) {
  const { note, onDeleted, onOpenPanel, onTextChange } = data;
  const [type, setType] = useState(note.type);
  const [customLabel, setCustomLabel] = useState(note.custom_label || '');
  const [text, setText] = useState(note.lines?.[0]?.text || '');
  const saveTimer = useRef(null);
  const lineId = note.lines?.[0]?.id;

  // Resync from the canonical copy only when something OUTSIDE this note
  // changed its text (promoting a variant, restoring a history entry) —
  // signaled by textVersion bumping. Ordinary re-renders (including the echo
  // of our own onTextChange mirror) don't bump it, so mid-keystroke typing
  // is never clobbered by this.
  useEffect(() => {
    setText(note.lines?.[0]?.text || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.textVersion]);

  const handleTextChange = useCallback((e) => {
    const val = e.target.value;
    setText(val);
    onTextChange?.(id, val);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { if (lineId) saveNoteText(lineId, val); }, 500);
  }, [lineId, id, onTextChange]);

  const handleTypeChange = useCallback((e) => {
    const val = e.target.value;
    setType(val);
    saveNoteType(id, val, val === 'custom' ? customLabel : null);
  }, [id, customLabel]);

  const handleCustomLabelBlur = useCallback(() => {
    saveNoteType(id, type, customLabel);
  }, [id, type, customLabel]);

  const handleDelete = useCallback(async (e) => {
    e.stopPropagation();
    if (!confirm('Delete this note?')) return;
    await deleteNote(id);
    onDeleted?.(id);
  }, [id, onDeleted]);

  const handleResizeEnd = useCallback((_evt, params) => {
    saveNotePosition(id, { x: params.x, y: params.y }, params.width, params.height);
  }, [id]);

  return (
    <div className={`canvas-note${selected ? ' selected' : ''}`}>
      <NodeResizer minWidth={200} minHeight={120} isVisible={selected} onResizeEnd={handleResizeEnd} />
      <Handle type="target" position={Position.Left} id="left" style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} id="right" style={HANDLE_STYLE} />
      <Handle type="target" position={Position.Bottom} id="chord" style={CHORD_HANDLE_STYLE} title="plug a chord progression in here" />

      <div className="canvas-note-head">
        <select value={type} onChange={handleTypeChange} className="canvas-note-type nodrag">
          {SECTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {type === 'custom' && (
          <input
            className="canvas-note-custom-label nodrag"
            value={customLabel}
            placeholder="label…"
            onChange={(e) => setCustomLabel(e.target.value)}
            onBlur={handleCustomLabelBlur}
          />
        )}
        <button
          className="canvas-note-details nodrag"
          onClick={(e) => { e.stopPropagation(); onOpenPanel?.(id); }}
          title="variants, notes, history, tools"
        >☰</button>
        <button className="canvas-note-delete nodrag" onClick={handleDelete} title="delete note">✕</button>
      </div>

      <textarea
        className="canvas-note-text nodrag nowheel"
        value={text}
        onChange={handleTextChange}
        placeholder="write…"
      />

      {note.chord_progression_id && (
        <div className="canvas-note-chip">🎵 chords assigned</div>
      )}
    </div>
  );
}
