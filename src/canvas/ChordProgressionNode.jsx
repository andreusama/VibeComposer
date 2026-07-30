import { useState, useCallback, useRef } from 'react';
import { Handle, Position, NodeResizer } from '@xyflow/react';
import { fretboardSVG } from '../components/fretboard.js';
import { playChord, playProgression } from '../audio/player.js';
import { saveProgressionContent, saveProgressionPosition, deleteChordProgression } from './canvasData.js';

const EMPTY_CHORD = () => ({ chord: '', function: '', feel: '', ukulele: [0, 0, 0, 0] });
const STRING_LABELS = ['G', 'C', 'E', 'A'];
const HANDLE_STYLE = { width: 10, height: 10, background: '#4552D6', border: '2px solid #fff' };

export default function ChordProgressionNode({ id, data, selected }) {
  const { progression: cp, onDeleted } = data;
  const [title, setTitle] = useState(cp.title);
  const [key, setKey] = useState(cp.key || '');
  const [chords, setChords] = useState(cp.progression?.length ? cp.progression : [EMPTY_CHORD()]);
  const saveTimer = useRef(null);

  const scheduleSave = useCallback((nextTitle, nextKey, nextChords) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveProgressionContent(id, { title: nextTitle, key: nextKey, progression: nextChords });
    }, 500);
  }, [id]);

  const updateChordName = (idx, value) => {
    const next = chords.map((c, i) => (i === idx ? { ...c, chord: value } : c));
    setChords(next);
    scheduleSave(title, key, next);
  };

  const updateFret = (idx, stringIdx, value) => {
    const fret = value === '' ? 0 : Number(value);
    const next = chords.map((c, i) =>
      i === idx ? { ...c, ukulele: c.ukulele.map((f, si) => (si === stringIdx ? fret : f)) } : c
    );
    setChords(next);
    scheduleSave(title, key, next);
  };

  const addChord = () => {
    const next = [...chords, EMPTY_CHORD()];
    setChords(next);
    scheduleSave(title, key, next);
  };

  const removeChord = (idx) => {
    const next = chords.filter((_, i) => i !== idx);
    setChords(next);
    scheduleSave(title, key, next);
  };

  const commitMeta = () => scheduleSave(title, key, chords);

  const handleDelete = async (e) => {
    e.stopPropagation();
    if (!confirm('Delete this progression?')) return;
    await deleteChordProgression(id);
    onDeleted?.(id);
  };

  const handleResizeEnd = (_evt, params) => {
    saveProgressionPosition(id, { x: params.x, y: params.y }, params.width, params.height);
  };

  const handlePlayAll = () => {
    const playable = chords.filter((c) => c.chord.trim());
    if (playable.length) playProgression(playable, 'medium');
  };

  const handlePlayOne = (ch) => {
    if (ch.chord.trim()) playChord(ch.ukulele, 'medium');
  };

  return (
    <div className={`canvas-cp${selected ? ' selected' : ''}`}>
      <NodeResizer minWidth={240} minHeight={180} isVisible={selected} onResizeEnd={handleResizeEnd} />
      {/* Single dedicated output — this is the only handle a chord-progression
          node has, and it only makes sense plugged into a text note's "chord"
          handle. No left/right main-thread-style handles here on purpose. */}
      <Handle type="source" position={Position.Right} id="assign" style={HANDLE_STYLE} title="drag to a note's chord plug" />

      <div className="canvas-cp-head">
        <input
          className="canvas-cp-title nodrag"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitMeta}
        />
        <input
          className="canvas-cp-key nodrag"
          value={key}
          placeholder="key"
          onChange={(e) => setKey(e.target.value)}
          onBlur={commitMeta}
        />
        <button className="canvas-cp-delete nodrag" onClick={handleDelete} title="delete progression">✕</button>
      </div>

      <div className="canvas-cp-chords nodrag nowheel">
        {chords.map((ch, i) => (
          <div className="canvas-cp-chord-row" key={i}>
            <input
              className="canvas-cp-chord-name"
              value={ch.chord}
              placeholder="Am"
              onChange={(e) => updateChordName(i, e.target.value)}
              onBlur={commitMeta}
            />
            <div className="canvas-cp-frets">
              {STRING_LABELS.map((label, si) => (
                <input
                  key={label}
                  className="canvas-cp-fret"
                  type="number"
                  title={`${label} string (fret, -1 = muted)`}
                  value={ch.ukulele[si]}
                  onChange={(e) => updateFret(i, si, e.target.value)}
                  onBlur={commitMeta}
                />
              ))}
            </div>
            <div
              className="canvas-cp-fretboard-mini"
              dangerouslySetInnerHTML={{ __html: fretboardSVG(ch.ukulele, '#4552D6') }}
            />
            <button className="canvas-cp-chord-play" onClick={() => handlePlayOne(ch)} title="play chord">▶</button>
            <button className="canvas-cp-chord-remove" onClick={() => removeChord(i)} title="remove chord">✕</button>
          </div>
        ))}
        <button className="canvas-cp-add nodrag" onClick={addChord}>+ chord</button>
      </div>

      <button className="canvas-cp-play-all nodrag" onClick={handlePlayAll}>▶ play progression</button>
    </div>
  );
}
